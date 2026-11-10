// 上传页「不合格照片进网格标红 + 每张压缩进度」组件自测（round-2，设计 2026-11-10-上传页-照片校验与压缩 ①②③ + 413）
// 用法：npm run test:upload（起 mock 模式 vite，端口 5182，无头 Chromium，手机 390×844）。
// 可选：SHOTS=<目录> 顺便截图；SHOT_PREFIX=文件名前缀；VIEWPORT=360x800 换尺寸；ROOT=<web 目录> 换被测代码；ASSERT=0 只截图不判定。
import { readFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = process.env.ROOT ? resolve(process.env.ROOT) : join(here, '..')
const PORT = Number(process.env.PORT || 5182)
const ASSERT = process.env.ASSERT !== '0'
const SHOTS = process.env.SHOTS
const PREFIX = process.env.SHOT_PREFIX ?? ''
const [vw, vh] = (process.env.VIEWPORT || '390x844').split('x').map(Number)
if (SHOTS) mkdirSync(SHOTS, { recursive: true })
const fx = (n) => readFileSync(join(here, 'fixtures', n))
const base = `http://127.0.0.1:${PORT}`

// 文案（与 contract.ts / compress.ts 同源）
const { heicPhotoText, tooBigPhotoText } = await import(join(ROOT, 'src/api/contract.ts'))
const COMPRESSED_TOO_BIG = '这张压缩后还是超过 1MB，传不上去，换一张或删掉它吧'

const BIG = Buffer.concat([fx('gps.jpg'), Buffer.alloc(Math.round(12.4 * 1024 * 1024))]) // 合法 JPEG + 尾部填充 → 12.4MB，仍能预览

const results = []
const check = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass, detail })
  console.log(`${pass ? '✔' : '✘'} ${name}${detail ? `  —— ${detail}` : ''}`)
}

const server = await createServer({ root: ROOT, mode: 'mock', server: { port: PORT, host: '127.0.0.1', strictPort: true }, logLevel: 'silent' })
await server.listen()
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome' })

async function open() {
  const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'zh-CN', reducedMotion: 'reduce' })
  await ctx.addInitScript(() => {
    if (sessionStorage.getItem('__t')) return
    sessionStorage.setItem('__t', '1')
    localStorage.clear()
    localStorage.setItem('koala-canteen:mock:chef-delay', String(1e9))
    localStorage.setItem('koala-canteen:mock:lag', '200')
    localStorage.setItem('koala-canteen:swipe-hint-seen', '1')
    indexedDB.deleteDatabase?.('koala-canteen')
  })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => check('页面无报错', false, e.message))
  await page.goto(base + '/kitchen/upload', { waitUntil: 'networkidle' })
  await page.waitForSelector('input[type=file]', { state: 'attached' })
  return { ctx, page }
}
const tiles = (p) => p.locator('.photo-grid .photo-tile')
const submitText = (p) => p.locator('.submit-bar button[type=submit]').innerText()
const waitIdle = (p) => p.waitForFunction(() => !document.querySelector('.photo-tile.is-pending') && !document.querySelector('.compress-card'), null, { timeout: 60000 })
async function shot(p, name, sel = '#f-photos') {
  if (!SHOTS) return
  await p.evaluate(() => document.fonts.ready)
  if (sel) await p.locator(sel).evaluate((el) => el.scrollIntoView({ block: 'start' }))
  await p.evaluate(() => window.scrollBy(0, -70))
  await p.waitForTimeout(250)
  const f = join(SHOTS, `${PREFIX}${name}.png`)
  await p.screenshot({ path: f })
  console.log('  📷', f)
}
async function del(p, i) {
  await tiles(p).nth(i).locator('.photo-del').click()
  await p.getByRole('button', { name: '删除', exact: true }).click()
  await p.waitForTimeout(300)
}

// ① HEIC + 超 10MB 进网格标红
{
  const { ctx, page } = await open()
  await page.locator('input[type=file]').first().setInputFiles([
    { name: 'IMG_2040.jpg', mimeType: 'image/jpeg', buffer: fx('gps.jpg') },
    { name: 'IMG_2041.jpg', mimeType: 'image/jpeg', buffer: fx('rot6.jpg') },
    { name: 'IMG_2034.HEIC', mimeType: 'image/heic', buffer: Buffer.from('heic') },
    { name: 'IMG_1988.jpg', mimeType: 'image/jpeg', buffer: BIG },
    { name: 'IMG_2045.png', mimeType: 'image/png', buffer: fx('alpha.png') },
  ])
  await waitIdle(page)
  await page.waitForTimeout(300)
  await shot(page, '上传-①不合格照片进网格标红')
  if (ASSERT) {
    check('5 张都进了网格（不合格的也在）', (await tiles(page).count()) === 5)
    const bad = await page.locator('.photo-tile.is-bad').evaluateAll((els) => els.map((e) => [...e.parentElement.children].indexOf(e)))
    check('第 3、4 张标红，其他不标', JSON.stringify(bad) === '[2,3]', JSON.stringify(bad))
    check('HEIC 缩略图：文件图标 + 底条“格式不支持”', (await tiles(page).nth(2).locator('.photo-file-ext').innerText()) === 'HEIC' && (await tiles(page).nth(2).locator('.photo-bad').innerText()) === '格式不支持')
    check('超 10MB 缩略图：照片预览 + 底条“超过 10MB”', (await tiles(page).nth(3).locator('img').count()) === 1 && (await tiles(page).nth(3).locator('.photo-bad').innerText()) === '超过 10MB')
    const list = await page.locator('.photo-problems').innerText()
    check('清单标题“有 2 张照片需要换一下”', list.includes('有 2 张照片需要换一下'))
    const heicT = heicPhotoText('IMG_2034.HEIC')
    const bigT = tooBigPhotoText('IMG_1988.jpg', BIG.length / 1024 / 1024)
    check('HEIC 文案 = contract.ts heicPhotoText', list.includes(heicT), heicT)
    check('超 10MB 文案 = contract.ts tooBigPhotoText（12.4 MB）', list.includes(bigT), bigT)
    check('HEIC 格子也按“第 N 张”可数（e2e photoTiles 定位不变）', (await page.getByRole('img', { name: /^第 \d+ 张$/ }).count()) === 5)
    const sizes = await page.locator('.photo-size:visible').allInnerTexts()
    check('合格的显示压缩后大小（封面格按现有样式不显示）', sizes.length === 2 && sizes.every((t) => /^\d[\d,]*KB$/.test(t.trim())), sizes.join(' / '))
    check('封面角标在第 1 张', (await tiles(page).nth(0).locator('.photo-cover-tag').count()) === 1)
    check('保存按钮：先换掉 2 张有问题的照片', (await submitText(page)).includes('先换掉 2 张有问题的照片'))
    await page.locator('#f-name').fill('番茄炒蛋')
    await page.getByRole('radio', { name: '家常菜' }).click()
    // aria-disabled 只是看起来灰，真人点得到；Playwright 会把它当不可点，所以 force
    await page.locator('.submit-bar button[type=submit]').click({ force: true })
    await page.waitForTimeout(500)
    const toast = await page.locator('[role=status], .toast').allInnerTexts()
    check('有红图时点保存：不提交、给提示', page.url().endsWith('/kitchen/upload') && toast.join(' ').includes('先换掉 2 张有问题的照片'), toast.join(' | ').slice(0, 80))
    // 本机草稿只存合格的
    await page.waitForTimeout(500)
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForTimeout(1200)
    check('刷新后恢复的草稿只有 3 张合格照片', (await tiles(page).count()) === 3 && (await page.locator('.photo-tile.is-bad').count()) === 0, `${await tiles(page).count()} 张`)
  }
  await ctx.close()
}

// ① 续：删掉红图后恢复
if (ASSERT) {
  const { ctx, page } = await open()
  await page.locator('input[type=file]').first().setInputFiles([
    { name: 'IMG_2040.jpg', mimeType: 'image/jpeg', buffer: fx('gps.jpg') },
    { name: 'IMG_2034.HEIC', mimeType: 'image/heic', buffer: Buffer.from('heic') },
    { name: 'IMG_1988.jpg', mimeType: 'image/jpeg', buffer: BIG },
  ])
  await waitIdle(page)
  await del(page, 1)
  check('删掉一张后：按钮变“先换掉第 2 张照片”，清单无标题', (await submitText(page)).includes('先换掉第 2 张照片') && !(await page.locator('.photo-problems').innerText()).includes('需要换一下'))
  await del(page, 1)
  check('红图都删掉后：按钮恢复、清单消失', (await submitText(page)).includes('交给厨驼写') && (await page.locator('.photo-problems').count()) === 0)
  await ctx.close()
}

// ② 压缩中：排队中 / 进度环 / 总进度
{
  const { ctx, page } = await open()
  await page.evaluate(async () => {
    const mk = async (i) => {
      const c = document.createElement('canvas')
      c.width = 1800
      c.height = 1350
      const g = c.getContext('2d')
      const d = g.createImageData(c.width, c.height)
      for (let k = 0; k < d.data.length; k += 4) {
        d.data[k] = (Math.random() * 255) | 0
        d.data[k + 1] = (k / 4 / c.width) % 255
        d.data[k + 2] = (Math.random() * 120) | 0
        d.data[k + 3] = 255
      }
      g.putImageData(d, 0, 0)
      const b = await new Promise((r) => c.toBlob(r, 'image/png'))
      return new File([b], `IMG_30${i}.png`, { type: 'image/png' })
    }
    const dt = new DataTransfer()
    for (let i = 0; i < 5; i++) dt.items.add(await mk(i))
    const inp = document.querySelector('input[type=file]')
    inp.files = dt.files
    inp.dispatchEvent(new Event('change', { bubbles: true }))
  })
  // ASSERT=0 对旧代码截“改前”图时没有进度环，退回等总进度卡片
  await page.waitForSelector(ASSERT ? '.photo-ring' : '.photo-ring, .compress-card', { timeout: 20000 })
  await page.waitForFunction(() => {
    const b = document.querySelector('.photo-ring b')
    return document.querySelector('.photo-size') && b && parseInt(b.textContent) > 15
  }, null, { timeout: 60000 }).catch(() => {})
  await shot(page, '上传-②压缩中每张进度')
  if (ASSERT) {
    const ring = await page.locator('.photo-ring b').first().innerText().catch(() => '')
    check('压缩中的那张显示进度环百分比', /^\d{1,3}%$/.test(ring), ring)
    check('未开始的显示“排队中”', (await page.getByText('排队中').count()) >= 1)
    check('顶部总进度“正在压缩照片”', (await page.locator('.compress-card').innerText()).includes('正在压缩照片'))
    check('保存按钮：正在压缩照片…（n/5）且不可点', /正在压缩照片…（\d\/5）/.test(await submitText(page)) && (await page.locator('.submit-bar button[type=submit]').isDisabled()))
    const seen = await page.evaluate(
      () =>
        new Promise((res) => {
          const vals = []
          const t = setInterval(() => {
            const b = document.querySelector('.photo-ring b')
            if (b) vals.push(parseInt(b.textContent))
            if (!document.querySelector('.compress-card')) {
              clearInterval(t)
              res(vals)
            }
          }, 30)
        }),
    )
    check('进度百分比会动（不止一个值）', new Set(seen).size > 1, `${[...new Set(seen)].slice(0, 8).join(',')}…`)
    await waitIdle(page)
    const sizes = await page.locator('.photo-size:visible').allInnerTexts()
    const kbs = sizes.map((t) => Number(t.replace(/[^\d]/g, '')))
    check('压完：每张（封面外）显示大小且 ≤1,024KB', kbs.length === 4 && kbs.every((n) => n > 0 && n <= 1024), sizes.join(' / '))
    const title = await page.locator('.photo-size').first().getAttribute('aria-label')
    check('读屏/悬停说明压了多少（原图 → 压缩后，小了 N%）', /→ .*KB（小了 \d+%）/.test(title ?? ''), title)
  }
  await ctx.close()
}

// ③ 压完仍 >1MB（mock：文件名含「压不下」）
{
  const { ctx, page } = await open()
  await page.locator('input[type=file]').first().setInputFiles([
    { name: 'IMG_2040.jpg', mimeType: 'image/jpeg', buffer: fx('gps.jpg') },
    { name: 'IMG_2041.jpg', mimeType: 'image/jpeg', buffer: fx('rot6.jpg') },
    { name: 'IMG_2045.png', mimeType: 'image/png', buffer: fx('alpha.png') },
    { name: 'IMG_2101压不下.jpg', mimeType: 'image/jpeg', buffer: fx('gps.jpg') },
  ])
  await waitIdle(page)
  await shot(page, '上传-③压完仍超过1MB')
  if (ASSERT) {
    check('第 4 张标红“压完 1.3MB”', (await tiles(page).nth(3).locator('.photo-bad').innerText()) === '压完 1.3MB')
    const list = await page.locator('.photo-problems').innerText()
    check('清单：设计原文 + “文件名 · 压缩后 1.3MB”', list.includes(COMPRESSED_TOO_BIG) && list.includes('IMG_2101压不下.jpg · 压缩后 1.3MB'))
    check('只有 1 张时不加标题', !list.includes('需要换一下'))
    check('保存按钮：先换掉第 4 张照片', (await submitText(page)).includes('先换掉第 4 张照片'))
  }
  await ctx.close()
}

// 上传时 413：标在那张上（mock：菜名含「超大」→ 第 1 张 413）
{
  const { ctx, page } = await open()
  await page.locator('input[type=file]').first().setInputFiles([{ name: 'IMG_2040.jpg', mimeType: 'image/jpeg', buffer: fx('gps.jpg') }])
  await waitIdle(page)
  await page.locator('#f-name').fill('超大番茄炒蛋')
  await page.getByRole('radio', { name: '家常菜' }).click()
  await page.locator('.submit-bar button[type=submit]').click()
  await page.waitForSelector('.photo-tile.is-bad', { timeout: 10000 }).catch(() => {})
  await page.waitForTimeout(400)
  await shot(page, '上传-413那张标红')
  if (ASSERT) {
    check('413 后第 1 张标红“超过 1MB”', (await tiles(page).nth(0).locator('.photo-bad').innerText().catch(() => '')) === '超过 1MB')
    check('清单写 413 原因', (await page.locator('.photo-problems').innerText().catch(() => '')).includes('照片太大了'))
    check('表单内容不丢', (await page.locator('#f-name').inputValue()) === '超大番茄炒蛋')
    check('只剩这 1 张红图也能删', await tiles(page).nth(0).locator('.photo-del').isEnabled())
  }
  await ctx.close()
}

// 超过 9 张：多的不加
if (ASSERT) {
  const { ctx, page } = await open()
  await page.locator('input[type=file]').first().setInputFiles(
    Array.from({ length: 10 }, (_, i) => ({ name: `IMG_40${i}.jpg`, mimeType: 'image/jpeg', buffer: fx('gps.jpg') })),
  )
  await waitIdle(page)
  check('选 10 张：只加 9 张并提示多出 1 张', (await tiles(page).count()) === 9 && (await page.locator('#f-photos').innerText()).includes('多出来的 1 张没加上'))
  await ctx.close()
}

await browser.close()
await server.close()
if (ASSERT) {
  const fail = results.filter((r) => !r.pass).length
  console.log(`\n共 ${results.length} 项，通过 ${results.length - fail}，失败 ${fail}`)
  process.exit(fail ? 1 : 0)
}
