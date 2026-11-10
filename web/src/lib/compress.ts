// 上传前在浏览器压缩照片：长边 ≤1600px，转 WebP（不支持回退 JPEG），目标约 500KB，硬上限 1MB；
// 先降质量、再缩尺寸，直到达标；按 EXIF 方向摆正；解码不了（如部分 HEIC）给友好提示。
// 隐私：所有照片一律经 canvas 重新编码（哪怕原图很小也不直传），输出不带 EXIF/GPS。

// 带 .ts 扩展名：scripts/compress.test.ts 用 node --experimental-strip-types 直接加载本文件
import { heicPhotoText, isHeic, LIMITS, tooBigPhotoText } from '../api/contract.ts'

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
  /** TOO_BIG 时：能压到的最小体积（字节），用来写“压完 1.3MB” */
  bytes?: number
  constructor(code: 'DECODE' | 'TOO_BIG', message: string, bytes?: number) {
    super(message)
    this.code = code
    this.bytes = bytes
  }
}

/** MB 显示：1 位小数（1024 进制），如 1.3MB */
export const mb1 = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)}MB`

/**
 * 上传页网格里一张不合格照片的说明（设计 2026-11-10-上传页-照片校验与压缩 ①③ + 说明 §5.12）。
 * tag：缩略图底部红条；detail：照片区下方清单正文；meta：清单里的灰色小字（文件名 · 大小）。
 * HEIC / 超 10MB 的正文直接用 contract.ts 的产品定稿（heicPhotoText / tooBigPhotoText），里面已带文件名，所以不再重复 meta。
 */
export interface PhotoProblem {
  kind: 'heic' | 'type' | 'tooBig' | 'decode' | 'compressedTooBig' | 'serverTooLarge'
  tag: string
  detail: string
  meta?: string
  /** 没法预览（HEIC/格式不对/打不开）：缩略图改成灰底文件图标 */
  noPreview?: boolean
}

export const PROBLEM_TEXT = {
  tagType: '格式不支持',
  tagTooBig: '超过 10MB',
  tagDecode: '打不开',
  /** 压缩后仍 >1MB（设计 ③ 原文） */
  compressedTooBig: '这张压缩后还是超过 1MB，传不上去，换一张或删掉它吧',
  tagServerTooLarge: '超过 1MB',
} as const

/** 文件扩展名（大写，没有就给“图片”），HEIC 等不能预览的缩略图上显示 */
export const extLabel = (name: string) => (/\.([a-z0-9]{1,5})$/i.exec(name)?.[1] ?? '').toUpperCase() || '文件'

/** 选图时逐张预检（不解码）：HEIC → 格式不对 → 超 10MB；合格返回 null */
export function precheckPhoto(f: { name: string; type: string; size: number }): PhotoProblem | null {
  if (isHeic(f)) return { kind: 'heic', tag: PROBLEM_TEXT.tagType, detail: heicPhotoText(f.name), noPreview: true }
  if (!(LIMITS.photoTypes as readonly string[]).includes(f.type))
    return { kind: 'type', tag: PROBLEM_TEXT.tagType, detail: `「${f.name}」不是 jpg/png/webp 格式的照片，换一张吧`, noPreview: true }
  if (f.size > LIMITS.photoMaxBytes) return { kind: 'tooBig', tag: PROBLEM_TEXT.tagTooBig, detail: tooBigPhotoText(f.name, f.size / (1024 * 1024)) }
  return null
}

/** 压缩失败 → 网格里的问题说明 */
export function compressProblem(name: string, e: unknown): PhotoProblem {
  if (e instanceof CompressError && e.code === 'TOO_BIG') {
    const b = e.bytes && e.bytes > LIMITS.uploadMaxBytes ? e.bytes : null
    return {
      kind: 'compressedTooBig',
      tag: b ? `压完 ${mb1(b)}` : PROBLEM_TEXT.tagServerTooLarge,
      detail: PROBLEM_TEXT.compressedTooBig,
      meta: b ? `${name} · 压缩后 ${mb1(b)}` : name,
    }
  }
  const msg = e instanceof CompressError ? e.message : `「${name}」处理失败，换一张试试`
  return { kind: 'decode', tag: isHeic({ name, type: '' }) ? PROBLEM_TEXT.tagType : PROBLEM_TEXT.tagDecode, detail: msg, noPreview: true }
}

/**
 * 单张压缩进度（0–100）的估算：解码完算 15%，之后每试一次编码往 95% 逼近，完成才到 100%。
 * 编码要试几次事先不知道，所以只保证单调递增、不提前到 100。
 */
export const compressPct = (tries: number) => (tries <= 0 ? 15 : Math.min(95, Math.round(15 + 80 * (1 - Math.pow(0.6, tries)))))

/** 纯逻辑：按“先降质量再缩尺寸”的顺序找到第一个达标的编码结果（便于单元测试，编码器可注入） */
export async function pickEncoding<T extends { size: number }>(
  width: number,
  height: number,
  encode: (w: number, h: number, q: number) => Promise<T>,
  opt: {
    maxSide?: number
    targetBytes?: number
    hardMaxBytes?: number
    qualities?: readonly number[]
    shrink?: number
    minSide?: number
    /** 每编码一次回调一次（tries 从 1 起），上传页用来画单张进度环 */
    onTry?: (tries: number) => void
  } = {},
): Promise<{ result: T; w: number; h: number; q: number; tries: number }> {
  const o = { ...COMPRESS, ...opt }
  let scale = Math.min(1, o.maxSide / Math.max(width, height))
  let tries = 0
  let smallest = Infinity
  for (;;) {
    const w = Math.max(1, Math.round(width * scale))
    const h = Math.max(1, Math.round(height * scale))
    let best: { result: T; q: number } | null = null
    for (const q of o.qualities) {
      const r = await encode(w, h, q)
      tries++
      o.onTry?.(tries)
      if (r.size < smallest) smallest = r.size
      if (r.size <= o.targetBytes) return { result: r, w, h, q, tries }
      if (r.size <= o.hardMaxBytes && !best) best = { result: r, q }
    }
    // 这个尺寸下降到最低质量都没到目标，但有 ≤1MB 的就用画质最高的那个
    if (best) return { result: best.result, w, h, q: best.q, tries }
    if (Math.max(w, h) <= o.minSide) throw new CompressError('TOO_BIG', '这张照片压不下来（超过 1MB），换一张试试', smallest)
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
        ? heicPhotoText(file.name)
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
export async function compressImage(file: File, onPct?: (pct: number) => void): Promise<CompressResult> {
  const img = await decode(file)
  onPct?.(compressPct(0))
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
    const { result, w, h, q } = await pickEncoding(img.width, img.height, encode, { onTry: (t) => onPct?.(compressPct(t)) })
    const ext = type === 'image/webp' ? 'webp' : 'jpg'
    const base = file.name.replace(/\.[^.]+$/, '') || 'photo'
    onPct?.(100)
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
