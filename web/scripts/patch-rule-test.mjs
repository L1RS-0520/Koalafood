// PATCH 规则集成测试（后端审查 P1-1/P1-2，码驼升 P0）：只改菜名时，厨驼的菜谱、来源、状态都不变；改内容才变成手写并确认。
// 用法：npm run test:patch                         # 只测 mock（浏览器里跑 src/api/mock.ts）
//       KOALA_API=http://127.0.0.1:8807 npm run test:patch   # 另外测真实接口（本地 wrangler dev，需 DEV_AUTH=1；只往这个实例写数据）
// 两边都用编辑页同一个 diffPatch 生成请求体。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const here = dirname(fileURLToPath(import.meta.url))
let pass = 0, fail = 0
const rec = (ok, what, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? '✔' : '✘'} ${what}${detail ? '  —— ' + detail : ''}`) }
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const pick = (d) => ({ ingredients: d.ingredients, steps: d.steps, tips: d.tips, servings: d.servings, total_time: d.total_time })

// —— 1. mock（浏览器） ——
const PORT = Number(process.env.PATCH_TEST_PORT) || 5197 // 默认 5197 不变
const server = await createServer({ root: join(here, '..'), mode: 'mock', server: { port: PORT, host: '127.0.0.1', strictPort: true }, logLevel: 'silent' })
await server.listen()
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome' })
const page = await browser.newPage()
await page.goto(`http://127.0.0.1:${PORT}/`)
const mock = await page.evaluate(async () => {
  localStorage.clear()
  localStorage.setItem('koala-canteen:mock:lag', '0')
  const { mockApi } = await import('/src/api/mock.ts')
  const { diffPatch, cleanContent } = await import('/src/lib/editPatch.ts')
  const out = {}
  for (const id of ['seed-tomato', 'seed-mango', 'seed-pork']) {
    const d = await mockApi.getDish(id)
    const c = cleanContent(d)
    const patch = diffPatch({ basics: { name: d.name, category: d.category, note: d.note }, content: c }, { name: d.name + '（改名）', category: d.category, note: d.note }, c)
    const after = await mockApi.updateDish(id, patch)
    out[id] = { patch, before: d, after }
  }
  const d = await mockApi.getDish('seed-tomato')
  const c = cleanContent(d)
  const c2 = { ...c, steps: [...c.steps, { text: '撒葱花', heat: '', time: '' }] }
  const patch = diffPatch({ basics: { name: d.name, category: d.category, note: d.note }, content: c }, { name: d.name, category: d.category, note: d.note }, c2)
  out.content = { patch, after: await mockApi.updateDish('seed-tomato', patch) }
  // v2.3.3：份量 / 总时长超过 20 字 → 400 VALIDATION（PATCH 和 POST）
  const err = async (fn) => { try { await fn(); return null } catch (e) { return { code: e.code, status: e.status, message: e.message } } }
  out.patch21 = await err(() => mockApi.updateDish('seed-tomato', { servings: '一'.repeat(21) }))
  // v2.3.3：JSON 请求体超过 64KB → 413 TOO_LARGE
  out.big = await err(() => mockApi.updateDish('seed-tomato', { tips: ['长'.repeat(30_000)] }))
  // v2.3.3：只写了编号 → 400 VALIDATION + details {field, index, reason:'only_number'}
  out.onlyNum = await (async () => { try { await mockApi.updateDish('seed-tomato', { steps: [{ text: '洗菜', heat: '', time: '' }, { text: '2.', heat: '', time: '' }] }); return null } catch (e) { return { code: e.code, status: e.status, message: e.message, details: e.details } } })()
  const blob = await (await fetch('/src/assets/logo.webp')).blob()
  out.post21 = await err(() => mockApi.createDish({ name: '超长测试', category: '其他', note: '', mode: 'manual', photos: [new File([blob], 'a.webp', { type: 'image/webp' })], content: { ingredients: [], steps: [], tips: [], servings: null, total_time: '一'.repeat(21) } }))
  // v2.3.3：访客不返回 chef_requested_at
  out.ownerHas = 'chef_requested_at' in (await mockApi.getDish('seed-mango'))
  localStorage.setItem('koala-canteen:mock:can_edit', '0')
  out.visitorHas = 'chef_requested_at' in (await mockApi.getDish('seed-mango'))
  localStorage.removeItem('koala-canteen:mock:can_edit')
  return out
})
for (const [id, label] of [['seed-tomato', '已确认的厨驼菜谱'], ['seed-mango', '待写'], ['seed-pork', '草稿待确认']]) {
  const { patch, before, after } = mock[id]
  rec(same(Object.keys(patch), ['name']), `mock ${label}：只改菜名 → patch 只有 name`, JSON.stringify(patch))
  rec(after.source === before.source && after.chef_status === before.chef_status, `mock ${label}：来源、状态不变`, `${before.source}/${before.chef_status} → ${after.source}/${after.chef_status}`)
  rec(same(pick(after), pick(before)) && same(after.draft, before.draft), `mock ${label}：菜谱内容${before.draft ? '和草稿' : ''}不变`)
}
rec(mock.content.after.source === 'manual' && mock.content.after.chef_status === 'confirmed' && same(Object.keys(mock.content.patch), ['steps']), 'mock 改了步骤 → 只发 steps，变成手写并确认')
rec(mock.patch21?.status === 400 && mock.patch21?.code === 'VALIDATION' && mock.patch21?.message === '份量最多 20 个字，现在 21 个字', 'mock PATCH 份量 21 字 → 400 VALIDATION', mock.patch21?.message)
rec(mock.post21?.status === 400 && mock.post21?.code === 'VALIDATION' && mock.post21?.message === '总时长最多 20 个字，现在 21 个字', 'mock POST（自己写）总时长 21 字 → 400 VALIDATION', mock.post21?.message)
rec(mock.big?.status === 413 && mock.big?.code === 'TOO_LARGE', 'mock PATCH 请求体超 64KB → 413 TOO_LARGE', mock.big?.message)
rec(mock.onlyNum?.status === 400 && mock.onlyNum?.details?.field === 'steps' && mock.onlyNum?.details?.index === 2 && mock.onlyNum?.details?.message === '第 2 步只写了编号，补上做法或删掉这一步' && mock.onlyNum?.details?.reason === 'only_number' && mock.onlyNum?.message === '第 2 步只写了编号，补上做法或删掉这一步', 'mock PATCH 只写编号的步骤 → 400 + details（index 1 起，带 message）', JSON.stringify(mock.onlyNum))
rec(mock.ownerHas === true && mock.visitorHas === false, 'mock 访客不返回 chef_requested_at（大王照常有）', `大王 ${mock.ownerHas} / 访客 ${mock.visitorHas}`)
await browser.close()

// —— 2. 真实接口（可选） ——
const B = process.env.KOALA_API
if (B) {
  if (/:8787\b|:8797\b/.test(B)) throw new Error('不要对共用的 8787 / 8797 写数据')
  const { diffPatch: dp, cleanContent: cc } = await server.ssrLoadModule('/src/lib/editPatch.ts')
  const login = await fetch(B + '/api/dev/login', { method: 'POST' })
  const cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
  rec(login.ok && !!cookie, '真实接口：本地模拟登录', String(login.status))
  const H = { cookie }
  const get = async (id) => (await fetch(`${B}/api/dishes/${id}`, { headers: H })).json()
  const patchReq = async (id, body) => fetch(`${B}/api/kitchen/dishes/${id}`, { method: 'PATCH', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  // 准备：新建一道找厨驼写的菜（pending），并找一道已确认的厨驼菜谱
  const fd = new FormData()
  fd.append('name', 'PATCH规则测试'); fd.append('category', '其他'); fd.append('note', ''); fd.append('mode', 'chef')
  fd.append('photos', new Blob([readFileSync(join(here, 'fixtures', 'gps.jpg'))], { type: 'image/jpeg' }), 'a.jpg')
  const created = await (await fetch(B + '/api/kitchen/dishes', { method: 'POST', headers: H, body: fd })).json()
  const list = (await (await fetch(B + '/api/dishes', { headers: H })).json()).dishes
  const chefConfirmed = list.find((d) => d.source === 'chef' && d.chef_status === 'confirmed')
  for (const [id, label] of [[chefConfirmed?.id, '已确认的厨驼菜谱'], [created.id, '待写（新建）']]) {
    if (!id) { rec(false, `真实接口 ${label}：没有可测的菜`); continue }
    const before = await get(id)
    const c = cc(before)
    const body = dp({ basics: { name: before.name, category: before.category, note: before.note }, content: c }, { name: before.name + '·改', category: before.category, note: before.note }, c)
    const r = await patchReq(id, body)
    const after = await get(id)
    rec(r.ok && same(Object.keys(body), ['name']) && after.name === before.name + '·改', `真实接口 ${label}：只改菜名成功，请求体只有 name`, `${r.status} ${JSON.stringify(body)}`)
    rec(after.source === before.source && after.chef_status === before.chef_status, `真实接口 ${label}：来源、状态不变`, `${before.source}/${before.chef_status} → ${after.source}/${after.chef_status}`)
    rec(same(pick(after), pick(before)), `真实接口 ${label}：菜谱内容不变`)
    await patchReq(id, { name: before.name }) // 改回原名
  }
  await fetch(`${B}/api/kitchen/dishes/${created.id}`, { method: 'DELETE', headers: H }) // 清掉测试菜
}
await server.close()
console.log(`\n共 ${pass + fail} 项，通过 ${pass}，失败 ${fail}${B ? '' : '（没设 KOALA_API，只测了 mock）'}`)
process.exit(fail ? 1 : 0)
