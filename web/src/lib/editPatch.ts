// 编辑页保存：只把真正改过的字段放进 PATCH（后端审查 P1-1，接口约定 v2.3.2 第 12 条）。
// 约定：PATCH 里只要出现任何一个内容键（值没变也算），就会变成 source=manual + confirmed，并作废厨驼任务；
// 只改 name/category/note 时 source、chef_status 不变。所以内容键必须和初始值做 diff，没改就不发。
// 纯逻辑、不依赖 React，scripts/editPatch.test.ts 用 node 直接测。
import { LIMITS } from '../api/contract.ts'
import type { DishPatch, RecipeContent, Step } from '../api/types.ts'

/** 会触发“改成手写并确认”的内容键 */
export const CONTENT_KEYS = ['ingredients', 'steps', 'tips', 'servings', 'total_time'] as const
export type ContentKey = (typeof CONTENT_KEYS)[number]

/** 清理编辑区内容：去首尾空格、丢掉空行、对白截到 12 字 */
export function cleanContent(c: RecipeContent): RecipeContent {
  return {
    ingredients: c.ingredients.map((i) => ({ name: i.name.trim(), amount: (i.amount ?? '').trim() })).filter((i) => i.name),
    steps: c.steps
      .map((s) => {
        const st: Step = { text: s.text.trim(), heat: (s.heat ?? '').trim(), time: (s.time ?? '').trim() }
        const cap = s.caption?.trim()
        if (cap) st.caption = [...cap].slice(0, LIMITS.captionMax).join('')
        return st
      })
      .filter((s) => s.text),
    tips: c.tips.map((t) => t.trim()).filter(Boolean),
    servings: c.servings?.trim() || null,
    total_time: c.total_time?.trim() || null,
  }
}

export interface BasicsLike {
  name: string
  category: string
  note: string | null
}

/** 和初始值比较，返回只含改动字段的 PATCH（两边都先 clean，避免空格、空行、空对白造成假改动） */
export function diffPatch(initial: { basics: BasicsLike; content: RecipeContent }, basics: BasicsLike, content: RecipeContent): DishPatch {
  const patch: DishPatch = {}
  const name = basics.name.trim()
  const note = basics.note?.trim() || null
  if (name !== initial.basics.name.trim()) patch.name = name
  if (basics.category !== initial.basics.category) patch.category = basics.category
  if (note !== (initial.basics.note?.trim() || null)) patch.note = note
  const a = cleanContent(initial.content)
  const b = cleanContent(content)
  for (const k of CONTENT_KEYS) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) (patch as Record<string, unknown>)[k] = b[k]
  }
  return patch
}

/** 份量 / 总时长超长：全中文「份量最多 20 个字，现在 N 个字」（产品复审 2026-11-10 定，不带英文字段名；mock 也用这句） */
export function metaErrors(c: Pick<RecipeContent, 'servings' | 'total_time'>): string[] {
  const out: string[] = []
  const chk = (key: 'servings' | 'total_time', label: string, max: number) => {
    const s = c[key]?.trim()
    const n = s ? [...s].length : 0
    if (n > max) out.push(`${label}最多 ${max} 个字，现在 ${n} 个字`)
  }
  chk('servings', '份量', LIMITS.servingsMax)
  chk('total_time', '总时长', LIMITS.totalTimeMax)
  return out
}

/** PATCH 里有没有内容键（有就会作废厨驼任务、改成手写） */
export const touchesContent = (patch: object) => CONTENT_KEYS.some((k) => k in patch)

// ---- 逐条校验错误（后端 v2.3.3：400 VALIDATION + details {field, index, reason}） ----
export type IssueField = 'steps' | 'ingredients' | 'tips'
export interface FieldIssue {
  field: IssueField
  /** 提交出去的（cleanContent 之后的）数组下标，0 起 */
  index: number
  reason: string
  message: string
}
/** details 里的 index 从几开始。按 JSON 数组下标 0 起；后端若改成 1 起只改这一处 */
export const ISSUE_INDEX_BASE = 0

/** 从 ApiError 里读出“第几条出错”；没有 details、旧版字符串数组、字段不认识都返回 null（按原来的方式处理） */
export function fieldIssueOf(err: unknown): FieldIssue | null {
  if (!err || typeof err !== 'object') return null
  const e = err as { code?: unknown; message?: unknown; details?: unknown }
  if (e.code !== 'VALIDATION') return null
  const d = (Array.isArray(e.details) ? e.details.find((x) => x && typeof x === 'object') : e.details) as Record<string, unknown> | undefined
  if (!d || typeof d !== 'object') return null
  const field = d.field
  if (field !== 'steps' && field !== 'ingredients' && field !== 'tips') return null
  const raw = typeof d.index === 'number' ? d.index : typeof d.index === 'string' && /^\d+$/.test(d.index) ? Number(d.index) : NaN
  if (!Number.isInteger(raw) || raw - ISSUE_INDEX_BASE < 0) return null
  return { field, index: raw - ISSUE_INDEX_BASE, reason: typeof d.reason === 'string' ? d.reason : '', message: typeof e.message === 'string' ? e.message : '' }
}

/** 编辑区里的原始行（含空行）→ 提交时 cleanContent 丢掉空行后的下标；反查回原始行下标，找不到返回 -1 */
export function rawIndexOf(c: RecipeContent, field: IssueField, cleanIndex: number): number {
  const keep: boolean[] =
    field === 'ingredients' ? c.ingredients.map((i) => !!i.name.trim()) : field === 'steps' ? c.steps.map((s) => !!s.text.trim()) : c.tips.map((t) => !!t.trim())
  let n = -1
  for (let i = 0; i < keep.length; i++) if (keep[i] && ++n === cleanIndex) return i
  return -1
}

/** “只写了编号”：如 3、3.、3、、第3步、（3）、①（后端 v2.3.3 reason=only_number，mock 用同一规则） */
const ONLY_NUMBER = /^[(（【[]?\s*(第\s*)?[0-9０-９一二三四五六七八九十百]+\s*[步条项样个]?\s*[)）】\]]?\s*[.．。、,，:：\-—~～]*$|^[①-⑳⑴-⒇❶-❿]$/
export const isOnlyNumber = (s: string) => ONLY_NUMBER.test(s.trim())

const ISSUE_TEXT: Record<IssueField, (n: number) => string> = {
  steps: (n) => `第 ${n} 步只写了编号，补上做法或删掉这一步`,
  ingredients: (n) => `第 ${n} 样食材只写了编号，补上名称或删掉这一样`,
  tips: (n) => `第 ${n} 条小贴士只写了编号，补上内容或删掉这一条`,
}
/** 对已 clean 的内容找第一条“只写了编号”的（mock 返回 400 用；顺序：食材 → 步骤 → 小贴士） */
export function onlyNumberIssue(c: Pick<RecipeContent, 'ingredients' | 'steps' | 'tips'>): FieldIssue | null {
  const lists: [IssueField, string[]][] = [
    ['ingredients', (c.ingredients ?? []).map((i) => i.name)],
    ['steps', (c.steps ?? []).map((s) => s.text)],
    ['tips', c.tips ?? []],
  ]
  for (const [field, xs] of lists) {
    const i = xs.findIndex((x) => isOnlyNumber(x))
    if (i >= 0) return { field, index: i, reason: 'only_number', message: ISSUE_TEXT[field](i + 1) }
  }
  return null
}
