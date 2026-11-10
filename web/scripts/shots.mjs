// 截图：npm run shots（起 mock 模式的 vite，Chromium 无头截图）。默认 round-1 全套；ROUND=round-2 只截 round-2 改动的页面。
// 只用前端内置 mock，不碰共享后端。可用 ONLY=关键字 只截部分。
import { mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const here = dirname(fileURLToPath(import.meta.url))
const ROUND = process.env.ROUND || 'round-1'
const out = join(here, '..', '..', '..', '截图', ROUND)
mkdirSync(out, { recursive: true })
const DAY = process.env.DAY || (ROUND === 'round-1' ? '2026-11-09' : '2026-11-10')
const PORT = 5198
const base = `http://127.0.0.1:${PORT}`

const M = { width: 390, height: 844 }
const D = { width: 1280, height: 800 }

/** name, path, viewport, flags, full, action */
const shotsR1 = [
  ['首页', '/', M, {}, false],
  ['首页-访客', '/', M, { visitor: true }, false],
  ['首页-桌面', '/', D, {}, false],
  ['首页-访客-桌面', '/', D, { visitor: true }, false],
  ['详情-正式', '/dishes/seed-tomato', M, {}, true],
  ['详情-访客', '/dishes/seed-tomato', M, { visitor: true }, true],
  ['详情-桌面', '/dishes/seed-tomato', D, {}, false],
  ['详情-访客-待写', '/dishes/seed-mango', M, { visitor: true }, false],
  ['详情-待写', '/dishes/seed-mango', M, {}, false],
  ['详情-草稿待确认', '/dishes/seed-pork', M, {}, true],
  ['详情-空草稿', '/dishes/seed-bfast', M, {}, false],
  ['详情-相册大图', '/dishes/seed-tomato', M, {}, false, async (p) => {
    await p.locator('.gallery-zoom, [aria-label*="大图"]').first().click()
    await p.waitForTimeout(500)
  }],
  ['上传-找厨驼写', '/kitchen/upload', M, {}, true],
  ['上传-自己写', '/kitchen/upload', M, {}, true, async (p) => {
    await p.getByRole('radio', { name: /自己写/ }).first().click().catch(() => p.getByText('自己写').first().click())
    await p.waitForTimeout(400)
  }],
  ['上传-厨驼关闭', '/kitchen/upload', M, { chefOff: true }, false],
  ['设置-开', '/kitchen/settings', M, {}, true],
  ['设置-关', '/kitchen/settings', M, { chefOff: true }, true],
  ['设置-用量提醒', '/kitchen/settings', M, { used: 0.86 * 996147200, ops: 850 }, true],
  ['上传-照片柜快满', '/kitchen/upload', M, { used: 0.96 * 996147200 }, false],
  ['后厨-未登录', '/kitchen/upload', M, { visitor: true }, false],
  ['上传-429提示条', '/kitchen/upload', M, {}, false, (p) => fillUpload(p, '塞满番茄炒蛋')],
  ['上传-507弹框', '/kitchen/upload', M, { used: 996147200 }, false, (p) => fillUpload(p, '番茄炒蛋')],
  ['上传-413标红', '/kitchen/upload', M, {}, false, async (p) => {
    await fillUpload(p, '超大番茄炒蛋')
    await p.locator('#f-photos').scrollIntoViewIfNeeded()
    await p.waitForTimeout(600)
  }],
  ['上传-逐张校验', '/kitchen/upload', M, {}, false, async (p) => {
    await p.locator('input[type=file]').first().setInputFiles([
      { name: 'IMG_1988.jpg', mimeType: 'image/jpeg', buffer: readFileSync(fx('gps.jpg')) },
      { name: 'IMG_2034.HEIC', mimeType: 'image/heic', buffer: Buffer.from('xx') },
      { name: 'IMG_2101.png', mimeType: 'image/png', buffer: readFileSync(fx('alpha.png')) },
    ])
    await p.waitForTimeout(2500)
  }],
  ['弹框-让厨驼重写', '/dishes/seed-pork', M, {}, false, async (p) => {
    await p.getByRole('button', { name: '让厨驼重写' }).first().click()
    await p.waitForTimeout(500)
  }],
  ['弹框-删除菜品', '/dishes/seed-tomato', M, {}, false, async (p) => {
    await p.getByRole('button', { name: /删除/ }).first().click()
    await p.waitForTimeout(500)
  }],
  ['弹框-离开未保存', '/kitchen/dishes/seed-tomato/edit', M, {}, false, async (p) => {
    await p.locator('#f-name').fill('番茄炒蛋（改）')
    await p.getByRole('button', { name: '返回' }).click()
    await p.waitForTimeout(500)
  }],
  ['草稿-修改后确认', '/kitchen/dishes/seed-pork/edit?confirm=1', M, {}, false],
]

/** round-2 改动的页面（产品审核 + 设计走查） */
const shotsR2 = [
  ['首页-大王-卡片精简', '/', M, {}, false],
  ['首页-访客-卡片精简', '/', M, { visitor: true }, false],
  ['首页-厨驼关闭-待写无蒙层', '/', M, { chefOff: true }, false],
  ['首页-桌面-5列', '/', D, {}, false],
  ['首页-空分类-访客', '/?category=其他', M, { visitor: true }, false],
  ['首页-空分类-大王', '/?category=其他', M, {}, false],
  ['上传-空分类预选', '/kitchen/upload?category=其他', M, {}, false],
  ['后厨-未登录-后厨重地', '/kitchen/upload', M, { visitor: true }, false],
  ['详情-正式-中文拟声词', '/dishes/seed-tomato', M, {}, true],
  ['详情-访客-顶栏', '/dishes/seed-tomato', M, { visitor: true }, false],
  ['详情-相册大图-缩略图条', '/dishes/seed-tomato', M, {}, false, async (p) => {
    await p.getByRole('button', { name: '放大看' }).click()
    await p.waitForTimeout(500)
  }],
  ['详情-相册-左右滑动提示', '/dishes/seed-tomato', M, { swipeHint: true }, false, null, 700],
  ['详情-待写', '/dishes/seed-mango', M, {}, false],
  ['详情-厨驼关闭-待写', '/dishes/seed-mango', M, { chefOff: true }, false],
  ['详情-草稿待确认', '/dishes/seed-pork', M, {}, true],
  ['详情-厨驼关闭-草稿3键', '/dishes/seed-pork', M, { chefOff: true }, false],
  ['弹框-不要这份草稿', '/dishes/seed-pork', M, {}, false, async (p) => {
    await p.getByRole('button', { name: '不要了' }).first().click()
    await p.waitForTimeout(500)
  }],
  ['确认-菜谱上线啦', '/dishes/seed-pork', M, {}, false, async (p) => {
    await p.getByRole('button', { name: '确认', exact: true }).click()
    await p.waitForTimeout(600)
  }],
  ['弹框-删除菜品-红按钮', '/dishes/seed-tomato', M, {}, false, async (p) => {
    await p.getByRole('button', { name: /删除/ }).first().click()
    await p.waitForTimeout(500)
  }],
  ['上传-HEIC与超10MB', '/kitchen/upload', M, {}, false, async (p) => {
    await p.locator('input[type=file]').first().setInputFiles([
      { name: 'IMG_1988.jpg', mimeType: 'image/jpeg', buffer: readFileSync(fx('gps.jpg')) },
      { name: 'IMG_2034.HEIC', mimeType: 'image/heic', buffer: Buffer.from('xx') },
      { name: 'IMG_2101.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(12.4 * 1024 * 1024) },
    ])
    await p.waitForTimeout(2500)
    await p.locator('#f-photos').scrollIntoViewIfNeeded()
  }],
  ['上传-429提示条', '/kitchen/upload', M, {}, false, (p) => fillUpload(p, '塞满番茄炒蛋')],
  ['上传-507弹框', '/kitchen/upload', M, { used: 996147200 }, false, (p) => fillUpload(p, '番茄炒蛋')],
  ['上传-照片柜快满-95', '/kitchen/upload', M, { used: 0.96 * 996147200 }, false],
  ['上传-照片柜80', '/kitchen/upload', M, { used: 0.86 * 996147200 }, false],
  ['设置-容量-正常', '/kitchen/settings', M, { used: 0.3 * 996147200 }, false],
  ['设置-容量-80', '/kitchen/settings', M, { used: 0.86 * 996147200, ops: 850 }, true],
  ['设置-容量-95', '/kitchen/settings', M, { used: 0.96 * 996147200 }, true],
  // 验收 R1-03 / v2.4.6 §12-33 第 1 条：已用 MB 1 位小数、95% 红条显示实际 N%、剩余 < 512,000 字节改“满啦”
  ['设置-用量提醒', '/kitchen/settings', M, { used: 0.86 * 996147200, ops: 850 }, true],
  ['设置-容量-99', '/kitchen/settings', M, { used: 996147200 - 512000 }, true],
  ['设置-容量-满', '/kitchen/settings', M, { used: 996147200 - 100000 }, true],
  ['改色-详情-空草稿红标签', '/dishes/seed-bfast', M, {}, false],
  ['改色-上传-413照片红条', '/kitchen/upload', M, {}, false, async (p) => {
    await fillUpload(p, '超大番茄炒蛋')
    await p.locator('#f-photos').scrollIntoViewIfNeeded()
    await p.waitForTimeout(600)
  }],
  ['改色-上传-必填错误圆点', '/kitchen/upload', M, {}, false, async (p) => {
    await p.locator('button[type=submit]').click()
    await p.waitForTimeout(600)
    await p.locator('#f-name').scrollIntoViewIfNeeded()
  }],
  ['改色-上传-80提示小字', '/kitchen/upload', M, { used: 0.86 * 996147200 }, false],
  ['编辑-逐条-点击区', '/kitchen/dishes/seed-tomato/edit', M, {}, false, async (p) => {
    await p.locator('#f-photos, .photos').first().scrollIntoViewIfNeeded().catch(() => {})
    await p.waitForTimeout(300)
  }],
]
const shots = ROUND === 'round-1' ? shotsR1 : shotsR2

const fx = (n) => join(here, 'fixtures', n)
/** 上传页：选 1 张图、填菜名、选分类、提交 */
async function fillUpload(p, name) {
  await p.locator('input[type=file]').first().setInputFiles(fx('gps.jpg'))
  await p.waitForTimeout(1500)
  await p.locator('#f-name').fill(name)
  await p.getByRole('radio', { name: '家常菜' }).click()
  await p.locator('button[type=submit]').click()
  await p.waitForTimeout(1800)
}

const server = await createServer({ root: join(here, '..'), mode: 'mock', server: { port: PORT, host: '127.0.0.1' }, logLevel: 'silent' })
await server.listen()
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome' })
const only = process.env.ONLY

for (const [name, path, vp, flags, full, act, wait = 2600] of shots) {
  if (only && !name.includes(only)) continue
  const phone = vp.width < 600
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, isMobile: phone, hasTouch: phone, locale: 'zh-CN', reducedMotion: 'reduce' })
  await ctx.addInitScript((f) => {
    if (sessionStorage.getItem('__shot')) return
    sessionStorage.setItem('__shot', '1')
    localStorage.clear()
    localStorage.setItem('koala-canteen:mock:chef-delay', String(1e9))
    localStorage.setItem('koala-canteen:mock:lag', '200')
    if (f.visitor) localStorage.setItem('koala-canteen:mock:can_edit', '0')
    if (f.used) localStorage.setItem('koala-canteen:mock:storage-used', String(Math.round(f.used)))
    if (f.ops) localStorage.setItem('koala-canteen:mock:ops-today', String(f.ops))
    if (f.chefOff) localStorage.setItem('koala-canteen:mock:chef-off', '1')
    if (!f.swipeHint) localStorage.setItem('koala-canteen:swipe-hint-seen', '1')
  }, flags)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log(`  [${name}] 页面报错：`, e.message))
  await page.goto(base + path, { waitUntil: 'networkidle' })
  await page.waitForTimeout(wait)
  if (act) await act(page)
  if (full) await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(200)
  await page.evaluate(() => document.fonts.ready)
  const file = join(out, `${DAY}-${name}.png`)
  await page.screenshot({ path: file, fullPage: !!full })
  console.log('✓', file)
  await ctx.close()
}
await browser.close()
await server.close()
