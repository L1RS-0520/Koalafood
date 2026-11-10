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

/** PATCH 里有没有内容键（有就会作废厨驼任务、改成手写） */
export const touchesContent = (patch: object) => CONTENT_KEYS.some((k) => k in patch)
