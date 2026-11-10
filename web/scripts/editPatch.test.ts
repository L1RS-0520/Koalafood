// 编辑页 PATCH diff 单元测试（后端审查 P1-1，码驼升 P0）：node --test --experimental-strip-types scripts/editPatch.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CONTENT_KEYS, diffPatch, touchesContent } from '../src/lib/editPatch.ts'

const content = () => ({
  ingredients: [{ name: '鸡蛋', amount: '3个' }],
  steps: [{ text: '打散', heat: '', time: '30秒', caption: '打散它！' }],
  tips: ['别炒老'],
  servings: '2人份',
  total_time: '15分钟',
})
const init = () => ({ basics: { name: '番茄炒蛋', category: '家常菜', note: '少放糖' }, content: content() })

test('只改菜名：只发 name，不带任何内容键（来源和厨驼任务都不会变）', () => {
  const p = diffPatch(init(), { name: '番茄炒鸡蛋', category: '家常菜', note: '少放糖' }, content())
  assert.deepEqual(p, { name: '番茄炒鸡蛋' })
  assert.equal(touchesContent(p), false)
})

test('只改分类、备注：只发这两个', () => {
  const p = diffPatch(init(), { name: '番茄炒蛋', category: '其他', note: '' }, content())
  assert.deepEqual(p, { category: '其他', note: null })
  assert.equal(touchesContent(p), false)
})

test('什么都没改：空 patch', () => {
  assert.deepEqual(diffPatch(init(), { name: ' 番茄炒蛋 ', category: '家常菜', note: '少放糖 ' }, content()), {})
})

test('只多了空行、空格：不算改内容', () => {
  const c = content()
  c.ingredients.push({ name: '  ', amount: '' })
  c.steps[0].text = ' 打散 '
  c.tips.push('   ')
  assert.deepEqual(diffPatch(init(), init().basics, c), {})
})

test('改了食材：只带 ingredients 这一个内容键', () => {
  const c = content()
  c.ingredients[0].amount = '4个'
  const p = diffPatch(init(), init().basics, c)
  assert.deepEqual(Object.keys(p), ['ingredients'])
  assert.equal(touchesContent(p), true)
})

test('五个内容键都能识别', () => {
  assert.deepEqual([...CONTENT_KEYS], ['ingredients', 'steps', 'tips', 'servings', 'total_time'])
  const c = { ...content(), servings: '3人份', total_time: null }
  assert.deepEqual(Object.keys(diffPatch(init(), init().basics, c)).sort(), ['servings', 'total_time'])
})

test('份量 / 总时长最多 20 字（按字符数），和后端同一句', async () => {
  const { metaErrors } = await import('../src/lib/editPatch.ts')
  assert.deepEqual(metaErrors({ servings: '2人份', total_time: '一'.repeat(20) }), [])
  assert.deepEqual(metaErrors({ servings: '😀'.repeat(21), total_time: null }), ['份量最多 20 个字，现在 21 个字'])
  assert.deepEqual(metaErrors({ servings: null, total_time: '一'.repeat(25) }), ['总时长最多 20 个字，现在 25 个字'])
})

test('只写了编号：判定规则', async () => {
  const { isOnlyNumber } = await import('../src/lib/editPatch.ts')
  for (const s of ['3', '3.', '3、', ' 12 ', '第3步', '第 3 步：', '（3）', '①', '三', '3)']) assert.equal(isOnlyNumber(s), true, s)
  for (const s of ['3. 鸡蛋打散', '鸡蛋', '3个鸡蛋', '炒 3 分钟', '盐 适量', '']) assert.equal(isOnlyNumber(s), false, s)
})

test('onlyNumberIssue：找第一条只写编号的，文案和后端一致（mock 用）', async () => {
  const { onlyNumberIssue } = await import('../src/lib/editPatch.ts')
  const step = (text: string) => ({ text, heat: '', time: '' })
  assert.equal(onlyNumberIssue({ ingredients: [{ name: '鸡蛋', amount: '2个' }], steps: [step('打散')], tips: [] }), null)
  assert.deepEqual(onlyNumberIssue({ ingredients: [], steps: [step('打散'), step('2.')], tips: [] }), {
    field: 'steps', index: 1, reason: 'only_number', message: '第 2 步只写了编号，补上做法或删掉这一步',
  })
  assert.equal(onlyNumberIssue({ ingredients: [{ name: '1', amount: '' }], steps: [], tips: [] })?.message, '第 1 样食材只写了编号，补上名称或删掉这一样')
  assert.equal(onlyNumberIssue({ ingredients: [], steps: [], tips: ['ok', '3'] })?.message, '第 2 条小贴士只写了编号，补上内容或删掉这一条')
})

test('fieldIssueOf：读 details {field, index, reason}；没有 / 旧字符串数组 / 非 VALIDATION 都返回 null', async () => {
  const { fieldIssueOf } = await import('../src/lib/editPatch.ts')
  const msg = '第 3 步只写了编号，补上做法或删掉这一步'
  // 后端 v2.3.3：index 从 1 起 → 换成 0 起；details.message 优先
  assert.deepEqual(fieldIssueOf({ code: 'VALIDATION', message: msg, details: { field: 'steps', index: 3, reason: 'only_number', message: msg } }), {
    field: 'steps', index: 2, reason: 'only_number', message: msg,
  })
  assert.equal(fieldIssueOf({ code: 'VALIDATION', message: '外层', details: { field: 'tips', index: 1, message: '里层' } })?.message, '里层')
  assert.equal(fieldIssueOf({ code: 'VALIDATION', message: 'x', details: { field: 'steps', index: 0 } }), null)
  assert.equal(fieldIssueOf({ code: 'VALIDATION', message: 'x' }), null)
  assert.equal(fieldIssueOf({ code: 'VALIDATION', message: 'x', details: ['食材最多 50 项'] }), null)
  assert.equal(fieldIssueOf({ code: 'VALIDATION', message: 'x', details: { field: 'name', index: 0 } }), null)
  assert.equal(fieldIssueOf({ code: 'VALIDATION', message: 'x', details: { field: 'steps', index: -1 } }), null)
  assert.equal(fieldIssueOf({ code: 'CONFLICT', message: 'x', details: { field: 'steps', index: 0 } }), null)
  assert.equal(fieldIssueOf(null), null)
})

test('rawIndexOf：提交下标（空行已丢）→ 编辑区原始行下标', async () => {
  const { rawIndexOf } = await import('../src/lib/editPatch.ts')
  const step = (text: string) => ({ text, heat: '', time: '' })
  const c = { ingredients: [], steps: [step(''), step('a'), step('  '), step('3')], tips: [], servings: null, total_time: null }
  assert.equal(rawIndexOf(c, 'steps', 0), 1)
  assert.equal(rawIndexOf(c, 'steps', 1), 3)
  assert.equal(rawIndexOf(c, 'steps', 2), -1)
})
