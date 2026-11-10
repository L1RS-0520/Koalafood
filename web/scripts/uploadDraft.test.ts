// 上传页本地草稿：只存文字、7 天过期（需求 v2.4.6 §12-33 第 2 条）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DRAFT_TTL_MS, LEAVE_UPLOAD_TEXT, loadText, saveText, TEXT_KEY } from '../src/lib/uploadDraft.ts'

const mem = () => {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m }
}
const draft = {
  name: '番茄炒蛋', category: '家常菜', note: '少糖', mode: 'manual' as const, editorMode: 'quick' as const,
  content: { ingredients: [], steps: [], tips: [], servings: null, total_time: null },
}

test('只存文字字段，不含照片', () => {
  const s = mem()
  saveText(draft, s, Date.parse('2026-11-10T05:00:00Z'))
  const raw = JSON.parse(s.m.get(TEXT_KEY)!)
  assert.deepEqual(Object.keys(raw).sort(), ['category', 'content', 'editorMode', 'mode', 'name', 'note', 'saved_at'])
  assert.equal(JSON.stringify(raw).includes('photo'), false)
})

test('7 天内能恢复，超过 7 天自动丢掉', () => {
  const s = mem()
  const t0 = Date.parse('2026-11-10T05:00:00Z')
  saveText(draft, s, t0)
  assert.equal(loadText(s, t0 + DRAFT_TTL_MS)?.name, '番茄炒蛋')
  assert.equal(loadText(s, t0 + DRAFT_TTL_MS + 1), null)
  assert.equal(s.m.has(TEXT_KEY), false)
})

test('坏数据当作没有草稿', () => {
  const s = mem()
  s.setItem(TEXT_KEY, '{oops')
  assert.equal(loadText(s), null)
  s.setItem(TEXT_KEY, JSON.stringify({ ...draft }))
  assert.equal(loadText(s), null) // 没有 saved_at
})

test('离开提示说明文字会保留、照片得重新选', () => {
  assert.match(LEAVE_UPLOAD_TEXT, /本机/)
  assert.match(LEAVE_UPLOAD_TEXT, /照片得重新选/)
})
