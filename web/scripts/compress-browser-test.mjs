// 压缩函数浏览器端自测（真实 Chromium canvas）：npm run test:compress
// 覆盖：带 GPS 的 JPEG 输出不含 EXIF（查 APP1/Exif 标记）、小图也重新编码、EXIF 方向摆正、
// 透明 PNG 铺白底、大图长边 ≤1600 且 ≤1MB、输出 WebP、HEIC 友好提示。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const here = dirname(fileURLToPath(import.meta.url))
const fx = (n) => readFileSync(join(here, 'fixtures', n)).toString('base64')

const server = await createServer({ root: join(here, '..'), mode: 'mock', server: { port: 5199, host: '127.0.0.1' }, logLevel: 'silent' })
await server.listen()
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome' })
const page = await browser.newPage()
await page.goto('http://127.0.0.1:5199/')

const results = await page.evaluate(
  async ({ gps, rot6, alpha }) => {
    const m = await import('/src/lib/compress.ts')
    const fromB64 = (b64, name, type) => new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], name, { type })
    const bytes = async (f) => new Uint8Array(await f.arrayBuffer())
    const hasExif = (u8) => {
      const s = 'Exif\0\0'
      outer: for (let i = 0; i < u8.length - 6; i++) {
        for (let j = 0; j < 6; j++) if (u8[i + j] !== s.charCodeAt(j)) continue outer
        return true
      }
      return false
    }
    // JPEG APP1 段（FF E1）
    const hasApp1 = (u8) => {
      for (let i = 0; i < u8.length - 1; i++) if (u8[i] === 0xff && u8[i + 1] === 0xe1) return true
      return false
    }
    const out = []
    const rec = (name, pass, detail) => out.push({ name, pass, detail })

    // 1. 带 GPS 的 JPEG
    const g = fromB64(gps, 'gps.jpg', 'image/jpeg')
    rec('原图确实带 EXIF', hasExif(await bytes(g)), '')
    const gr = await m.compressImage(g)
    const gb = await bytes(gr.file)
    rec('GPS JPEG → 输出不含 Exif/APP1', !hasExif(gb) && !(gr.file.type === 'image/jpeg' && hasApp1(gb)), `${gr.file.type} ${gb.length}B`)
    rec('小图（<500KB）也经 canvas 重新编码', gr.file !== g && gr.file.type === 'image/webp', gr.file.name)

    // 2. EXIF 方向 6：像素 400x200 → 应输出 200x400
    const rr = await m.compressImage(fromB64(rot6, 'rot6.jpg', 'image/jpeg'))
    rec('EXIF 方向摆正（400x200 + Orientation=6 → 200x400）', rr.width === 200 && rr.height === 400, `${rr.width}x${rr.height}`)

    // 3. 透明 PNG 铺白底：左上角像素应为白
    const ar = await m.compressImage(fromB64(alpha, 'alpha.png', 'image/png'))
    const bmp = await createImageBitmap(ar.file)
    const c = document.createElement('canvas')
    c.width = bmp.width
    c.height = bmp.height
    const ctx = c.getContext('2d')
    ctx.drawImage(bmp, 0, 0)
    const [r, gg, b, a] = ctx.getImageData(5, 5, 1, 1).data
    rec('透明 PNG 先铺白底', r > 245 && gg > 245 && b > 245 && a === 255, `rgba(${r},${gg},${b},${a})`)

    // 4. 大噪声图（4000x3000，几乎不可压）→ 长边 ≤1600、≤1MB
    const big = document.createElement('canvas')
    big.width = 4000
    big.height = 3000
    const bc = big.getContext('2d')
    const id = bc.createImageData(4000, 3000)
    for (let i = 0; i < id.data.length; i += 4) {
      id.data[i] = (Math.random() * 255) | 0
      id.data[i + 1] = (Math.random() * 255) | 0
      id.data[i + 2] = (Math.random() * 255) | 0
      id.data[i + 3] = 255
    }
    bc.putImageData(id, 0, 0)
    const bigBlob = await new Promise((res) => big.toBlob(res, 'image/png'))
    const t0 = performance.now()
    const br = await m.compressImage(new File([bigBlob], 'noise.png', { type: 'image/png' }))
    rec(
      '超大噪声图 → 长边 ≤1600 且 ≤1MB',
      Math.max(br.width, br.height) <= 1600 && br.file.size <= 1024 * 1024,
      `原 ${(bigBlob.size / 1048576).toFixed(1)}MB → ${br.width}x${br.height} q=${br.quality} ${(br.file.size / 1024).toFixed(0)}KB，${Math.round(performance.now() - t0)}ms`,
    )

    // 5. 普通照片接近 500KB 目标
    rec('输出格式为 WebP（浏览器支持时）', br.file.type === 'image/webp', br.file.type)

    // 6. HEIC 解码失败 → 友好提示
    try {
      await m.compressImage(new File([new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 104, 101, 105, 99])], 'IMG_0001.HEIC', { type: 'image/heic' }))
      rec('HEIC 给友好提示', false, '竟然没报错')
    } catch (e) {
      // 与选图校验共用同一句定稿（contract.ts PHOTO_TEXT.heic）
      const want = (await import('/src/api/contract.ts')).PHOTO_TEXT.heic('IMG_0001.HEIC')
      rec('HEIC 给友好提示（与选图校验同一句定稿）', e.code === 'DECODE' && e.message === want, e.message)
    }

    // 7. 批量进度回调
    const prog = []
    await m.compressAll([fromB64(gps, 'a.jpg', 'image/jpeg'), fromB64(gps, 'b.jpg', 'image/jpeg')], (d, t) => prog.push(`${d}/${t}`))
    rec('批量压缩进度回调', prog.join(',') === '0/2,1/2,2/2', prog.join(','))
    return out
  },
  { gps: fx('gps.jpg'), rot6: fx('rot6.jpg'), alpha: fx('alpha.png') },
)

let fail = 0
for (const r of results) {
  console.log(`${r.pass ? '✔' : '✘'} ${r.name}${r.detail ? `  —— ${r.detail}` : ''}`)
  if (!r.pass) fail++
}
console.log(`\n共 ${results.length} 项，通过 ${results.length - fail}，失败 ${fail}`)
await browser.close()
await server.close()
process.exit(fail ? 1 : 0)
