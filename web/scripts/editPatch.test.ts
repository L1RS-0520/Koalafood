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
