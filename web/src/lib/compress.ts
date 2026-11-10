// 上传前在浏览器压缩照片：长边 ≤1600px，转 WebP（不支持回退 JPEG），目标约 500KB，硬上限 1MB；
// 先降质量、再缩尺寸，直到达标；按 EXIF 方向摆正；解码不了（如部分 HEIC）给友好提示。
// 隐私：所有照片一律经 canvas 重新编码（哪怕原图很小也不直传），输出不带 EXIF/GPS。

// 带 .ts 扩展名：scripts/compress.test.ts 用 node --experimental-strip-types 直接加载本文件
import { isHeic, PHOTO_TEXT } from '../api/contract.ts'

export const COMPRESS = {
  maxSide: 1600,
  targetBytes: 500 * 1024,
  hardMaxBytes: 1024 * 1024,
  qualities: [0.82, 0.74, 0.66, 0.58, 0.5, 0.42],
  shrink: 0.8,
  minSide: 480,
} as const

export class CompressError extends Error {
  code: 'DECODE' | 'TOO_BIG'
  constructor(code: 'DECODE' | 'TOO_BIG', message: string) {
    super(message)
    this.code = code
  }
}

/** 纯逻辑：按“先降质量再缩尺寸”的顺序找到第一个达标的编码结果（便于单元测试，编码器可注入） */
export async function pickEncoding<T extends { size: number }>(
  width: number,
  height: number,
  encode: (w: number, h: number, q: number) => Promise<T>,
  opt: { maxSide?: number; targetBytes?: number; hardMaxBytes?: number; qualities?: readonly number[]; shrink?: number; minSide?: number } = {},
): Promise<{ result: T; w: number; h: number; q: number; tries: number }> {
  const o = { ...COMPRESS, ...opt }
  let scale = Math.min(1, o.maxSide / Math.max(width, height))
  let tries = 0
  for (;;) {
    const w = Math.max(1, Math.round(width * scale))
    const h = Math.max(1, Math.round(height * scale))
    let best: { result: T; q: number } | null = null
    for (const q of o.qualities) {
      const r = await encode(w, h, q)
      tries++
      if (r.size <= o.targetBytes) return { result: r, w, h, q, tries }
      if (r.size <= o.hardMaxBytes && !best) best = { result: r, q }
    }
    // 这个尺寸下降到最低质量都没到目标，但有 ≤1MB 的就用画质最高的那个
    if (best) return { result: best.result, w, h, q: best.q, tries }
    if (Math.max(w, h) <= o.minSide) throw new CompressError('TOO_BIG', '这张照片压不下来（超过 1MB），换一张试试')
    scale *= o.shrink
  }
}

async function decode(file: File): Promise<{ src: CanvasImageSource; width: number; height: number; close(): void }> {
  // 首选 createImageBitmap，按 EXIF 方向摆正
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return { src: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() }
    } catch {
      /* 回退到 <img> */
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode() // 现代浏览器 <img> 默认 image-orientation: from-image
    return { src: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) }
  } catch {
    URL.revokeObjectURL(url)
    throw new CompressError(
      'DECODE',
      isHeic(file)
        ? PHOTO_TEXT.heic(file.name)
        : `「${file.name}」打不开，可能文件坏了或格式不支持，换一张试试`,
    )
  }
}

let webpOk: boolean | null = null
async function supportsWebp(): Promise<boolean> {
  if (webpOk !== null) return webpOk
  const c = document.createElement('canvas')
  c.width = c.height = 2
  const b = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/webp', 0.8))
  webpOk = !!b && b.type === 'image/webp'
  return webpOk
}

export interface CompressResult {
  file: File
  width: number
  height: number
  quality: number
  originalBytes: number
}

/** 压缩一张照片 */
export async function compressImage(file: File): Promise<CompressResult> {
  const img = await decode(file)
  try {
    const type = (await supportsWebp()) ? 'image/webp' : 'image/jpeg'
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')!
    const encode = async (w: number, h: number, q: number): Promise<Blob> => {
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'high'
        // 透明 PNG 一律先铺白底（WebP/JPEG 都一样，避免透明区变黑或发灰）
        ctx.fillStyle = '#fff'
        ctx.fillRect(0, 0, w, h)
        ctx.drawImage(img.src, 0, 0, w, h)
      }
      const b = await new Promise<Blob | null>((r) => canvas.toBlob(r, type, q))
      if (!b) throw new CompressError('DECODE', `「${file.name}」处理失败，换一张试试`)
      return b
    }
    const { result, w, h, q } = await pickEncoding(img.width, img.height, encode)
    const ext = type === 'image/webp' ? 'webp' : 'jpg'
    const base = file.name.replace(/\.[^.]+$/, '') || 'photo'
    return { file: new File([result], `${base}.${ext}`, { type, lastModified: Date.now() }), width: w, height: h, quality: q, originalBytes: file.size }
  } finally {
    img.close()
  }
}

/** 批量压缩，带进度；失败的单独收集中文原因 */
export async function compressAll(
  files: File[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ files: File[]; errors: string[] }> {
  const out: File[] = []
  const errors: string[] = []
  onProgress?.(0, files.length)
  for (let i = 0; i < files.length; i++) {
    try {
      out.push((await compressImage(files[i])).file)
    } catch (e) {
      errors.push(e instanceof CompressError ? e.message : `「${files[i].name}」处理失败，换一张试试`)
    }
    onProgress?.(i + 1, files.length)
  }
  return { files: out, errors }
}
