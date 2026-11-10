// 手机真触摸拖动（CDP Input.dispatchTouchEvent）+ 电脑鼠标拖动：第 1 张拖到第 3 张
// 用法：BASE_URL=http://127.0.0.1:端口（mock 构建的 vite preview）npm run test:drag。验收 R1-02 / e2e B01
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5232'
const IMG = process.env.KOALA_QA || fx(dirname(fileURLToPath(import.meta.url)), '../../../qa')
import { readdirSync } from 'node:fs'
import { join as fx } from 'node:path'
const b = await chromium.launch()
const dir = (() => { for (const d of ['testdata']) { try { const f = readdirSync(fx(IMG, d)).filter((n) => /^multi-0[123]\.jpg$/.test(n)); if (f.length === 3) return fx(IMG, d) } catch {} } return null })()
const files = dir ? ['multi-01.jpg', 'multi-02.jpg', 'multi-03.jpg'].map((n) => fx(dir, n)) : null
let fail = 0
for (const mode of ['touch', 'mouse']) {
  const ctx = await b.newContext(mode === 'touch' ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 800 } })
  await ctx.addInitScript(() => { if (sessionStorage.getItem('i')) return; sessionStorage.setItem('i', '1'); localStorage.clear(); localStorage.setItem('koala-canteen:mock:lag', '50') })
  const p = await ctx.newPage()
  await p.goto(BASE + '/kitchen/upload', { waitUntil: 'networkidle' })
  await p.locator('input[type=file]').setInputFiles(files)
  await p.waitForFunction(() => document.querySelectorAll('.photo-tile').length === 3 && !document.querySelector('.photo-tile.is-pending'), null, { timeout: 60000 })
  const srcs = () => p.$$eval('.photo-tile img', (xs) => xs.map((x) => x.getAttribute('src')))
  const before = await srcs()
  const h = await p.getByRole('button', { name: '拖动调整第 1 张的位置' }).boundingBox()
  await p.locator('.photo-tile').nth(2).scrollIntoViewIfNeeded()
  const hb = await p.getByRole('button', { name: '拖动调整第 1 张的位置' }).boundingBox()
  const tb = await p.locator('.photo-tile').nth(2).boundingBox()
  const a = { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 }, z = { x: tb.x + tb.width / 2, y: tb.y + tb.height / 2 }
  if (mode === 'touch') {
    const cdp = await ctx.newCDPSession(p)
    const t = (type, pt) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pt ? [{ x: pt.x, y: pt.y }] : [] })
    await t('touchStart', a)
    for (let k = 1; k <= 12; k++) await t('touchMove', { x: a.x + ((z.x - a.x) * k) / 12, y: a.y + ((z.y - a.y) * k) / 12 })
    await t('touchEnd')
  } else {
    await p.mouse.move(a.x, a.y); await p.mouse.down(); await p.mouse.move(z.x, z.y, { steps: 12 }); await p.mouse.up()
  }
  await p.waitForTimeout(400)
  const after = await srcs()
  const ok = after[2] === before[0] && after[0] === before[1]
  if (!ok) fail++
  console.log(`${ok ? '✔' : '✘'} ${mode} 第 1 张拖到第 3 张：${JSON.stringify(before.map((s) => before.indexOf(s) + 1))} → ${JSON.stringify(after.map((s) => before.indexOf(s) + 1))}`)
  await ctx.close()
}
await b.close()
process.exit(fail ? 1 : 0)
