// 逐条校验错误的页面行为（后端 v2.3.3 details）：编辑页把第 1 步改成“2.”保存 →
// 滚到第 1 步并聚焦、旁边一直显示说明（等 5 秒还在），改动那一步后说明消失；不发 toast。
// 再加一条 3 万字的小贴士保存 → mock 413 → 提示「内容太长了，删减一点再保存」，表单不丢。
// 用 mock 构建：BASE_URL=http://127.0.0.1:端口（vite preview --outDir dist-mock），默认 5232。
import { chromium } from 'playwright'
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5232'
const res = []
const rec = (ok, name, info = '') => (res.push(ok), console.log(`${ok ? '✔' : '✘'} ${name}${info ? `  —— ${info}` : ''}`))
const b = await chromium.launch()
for (const vp of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
  const p = await b.newPage({ viewport: vp })
  p.setDefaultTimeout(60_000)
  await p.addInitScript(() => {
    if (sessionStorage.getItem('init')) return
    sessionStorage.setItem('init', '1')
    localStorage.clear()
    localStorage.setItem('koala-canteen:mock:chef-delay', '1e9')
    localStorage.setItem('koala-canteen:mock:lag', '50')
  })
  await p.goto(`${BASE}/kitchen/dishes/seed-tomato/edit`, { timeout: 120_000 })
  await p.getByRole('radio', { name: '快速填写' }).click() // 从快速模式开始，验证会自动切到逐条
  const ta = p.locator('.quick textarea').nth(1)
  const old = await ta.inputValue()
  await ta.fill(['2.', ...old.split('\n').slice(1)].join('\n'))
  await p.getByRole('button', { name: /^保存/ }).click()
  const note = p.locator('.row-err')
  await note.waitFor()
  const w = vp.width
  rec((await note.innerText()).includes('第 1 步只写了编号，补上做法或删掉这一步'), `${w} 说明文字`)
  rec(await p.evaluate(() => document.activeElement?.getAttribute('aria-label')) === '第 1 步内容', `${w} 聚焦到第 1 步`)
  const box = await p.locator('[aria-label="第 1 步内容"]').boundingBox()
  rec(!!box && box.y >= 0 && box.y + box.height <= vp.height, `${w} 第 1 步在可视区内`, JSON.stringify(box && Math.round(box.y)))
  rec(!(await p.locator('.toasts').innerText()).includes('只写了编号'), `${w} 没有用 toast 代替`)
  await p.waitForTimeout(5000)
  rec(await note.isVisible(), `${w} 5 秒后说明还在`)
  await p.locator('[aria-label="第 1 样食材用量"]').fill('3个')
  rec(await note.isVisible(), `${w} 改别的栏（食材）说明不消失`)
  await p.locator('[aria-label="第 1 步内容"]').fill('鸡蛋打散')
  rec((await note.count()) === 0, `${w} 改了第 1 步后说明消失`)
  // 后端 v2.3.3：JSON 超 64KB → 413；提示「内容太长了，删减一点再保存」，留在本页、表单不丢
  await p.getByRole('button', { name: '加一条小贴士' }).click()
  const tip = p.locator('[aria-label^="第"][aria-label$="条小贴士"]').last()
  await tip.fill('长'.repeat(30_000))
  await p.getByRole('button', { name: /^保存/ }).click()
  await p.locator('.toasts', { hasText: '内容太长了，删减一点再保存' }).waitFor({ timeout: 15_000 }).then(() => rec(true, `${w} 413 提示内容太长`), () => rec(false, `${w} 413 提示内容太长`))
  rec(p.url().endsWith('/edit') && (await tip.inputValue()).length === 30_000 && (await p.locator('[aria-label="第 1 步内容"]').inputValue()) === '鸡蛋打散', `${w} 413 后留在编辑页、填的都还在`)
  await p.close()
}
await b.close()
const bad = res.filter((x) => !x).length
console.log(`\n共 ${res.length} 项，通过 ${res.length - bad}，失败 ${bad}`)
process.exit(bad ? 1 : 0)
