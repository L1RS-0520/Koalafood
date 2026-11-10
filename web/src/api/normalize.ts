// 把后端/AI 返回的数据收拾成前端可放心用的形状；草稿格式不对时抛 AI_BAD_FORMAT
import { STORAGE, CHEF_STATUS, SOURCE, STATUS_ALIASES, STATUS_FIELD, STATUS_FIELD_FALLBACKS } from './contract'
import type { Storage, StorageLevel, ChefStatus, Dish, Photo, DishSource, DishSummary, Draft, Ingredient, RecipeContent, Step } from './types'

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '')
const strOrNull = (v: unknown): string | null => {
  const s = str(v)
  return s ? s : null
}

export function normIngredients(v: unknown): Ingredient[] {
  if (!Array.isArray(v)) return []
  return v
    .map((it) => {
      if (typeof it === 'string') return splitIngredientLine(it)
      if (it && typeof it === 'object') {
        const o = it as Record<string, unknown>
        return { name: str(o.name), amount: str(o.amount) }
      }
      return { name: '', amount: '' }
    })
    .filter((i) => i.name)
}

export function normSteps(v: unknown): Step[] {
  if (!Array.isArray(v)) return []
  return v
    .map((it): Step => {
      // 需求文档里 steps 曾是字符串数组，这里兼容
      if (typeof it === 'string') return { text: it.trim(), heat: '', time: '' }
      const o = (it ?? {}) as Record<string, unknown>
      const step: Step = { text: str(o.text), heat: str(o.heat), time: str(o.time) }
      const cap = str(o.caption)
      if (cap) step.caption = cap
      return step
    })
    .filter((s) => s.text)
}

export function normTips(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.map(str).filter(Boolean)
}

function normContent(o: Record<string, unknown>): RecipeContent {
  return {
    ingredients: normIngredients(o.ingredients),
    steps: normSteps(o.steps),
    tips: normTips(o.tips),
    servings: strOrNull(o.servings),
    total_time: strOrNull(o.total_time),
  }
}

export function normStatus(o: Record<string, unknown>): ChefStatus {
  const raw = [STATUS_FIELD, ...STATUS_FIELD_FALLBACKS].map((k) => o[k]).find((v) => typeof v === 'string')
  return STATUS_ALIASES[String(raw ?? '')] ?? CHEF_STATUS.confirmed
}
export const normSource = (v: unknown): DishSource => (v === SOURCE.manual ? SOURCE.manual : SOURCE.chef)

function normPhotos(o: Record<string, unknown>): { photos: Photo[]; photo_url: string } {
  const list = Array.isArray(o.photos)
    ? (o.photos as unknown[])
        .map((p, i) => {
          const r = (p ?? {}) as Record<string, unknown>
          return { id: str(r.id) || str(r.key) || `p${i}`, url: str(r.url) }
        })
        .filter((p) => p.url)
    : []
  const cover = str(o.photo_url)
  if (list.length === 0 && cover) list.push({ id: 'cover', url: cover })
  return { photos: list, photo_url: list[0]?.url ?? cover }
}

export function normDish(raw: unknown): Dish {
  const o = (raw ?? {}) as Record<string, unknown>
  const status = normStatus(o)
  const draftRaw = o.draft && typeof o.draft === 'object' ? (o.draft as Record<string, unknown>) : null
  const draft: Draft | null =
    status === CHEF_STATUS.draft
      ? { ...normContent(draftRaw ?? {}), chef_message: strOrNull(draftRaw?.chef_message) ?? strOrNull(o.chef_message) }
      : null
  return {
    id: str(o.id),
    name: str(o.name),
    category: str(o.category) || '其他',
    note: strOrNull(o.note),
    ...normPhotos(o),
    ...normContent(o),
    chef_status: status,
    source: normSource(o.source),
    draft,
    chef_message: strOrNull(o.chef_message) ?? draft?.chef_message ?? null,
    requested_note: strOrNull(o.requested_note),
    chef_requested_at: strOrNull(o.chef_requested_at) ?? strOrNull(o.requested_at),
    created_at: str(o.created_at),
    updated_at: str(o.updated_at),
  }
}

export function normSummary(raw: unknown): DishSummary {
  const o = (raw ?? {}) as Record<string, unknown>
  return {
    id: str(o.id),
    name: str(o.name),
    category: str(o.category) || '其他',
    photo_url: str(o.photo_url),
    photo_count: typeof o.photo_count === 'number' ? o.photo_count : 1,
    total_time: strOrNull(o.total_time),
    chef_status: normStatus(o),
    source: normSource(o.source),
    created_at: str(o.created_at),
  }
}

/** 内容是否全空 */
export const isEmptyContent = (c: RecipeContent) => c.ingredients.length === 0 && c.steps.length === 0 && c.tips.length === 0

/**
 * 一行食材拆成 名称 + 用量：
 * “鸡蛋 3个” / “鸡蛋：3个” / “鸡蛋3个” / “盐适量” / “- 葱花 一把”
 */
export function splitIngredientLine(line: string): Ingredient {
  const s = line.trim().replace(/^([-*•·]|\d+[.、)）])\s*/, '').trim()
  if (!s) return { name: '', amount: '' }
  let m = s.match(/^(.+?)[\s\u3000:：,，]+(\S.*)$/)
  if (m) return { name: m[1].trim(), amount: m[2].trim() }
  m = s.match(/^(\D+?)(\d[\d./~\-～]*\s*\S*)$/)
  if (m) return { name: m[1].trim(), amount: m[2].trim() }
  m = s.match(/^(.+?)(适量|少许|若干|一点|一把|一勺|半勺)$/)
  if (m) return { name: m[1].trim(), amount: m[2] }
  return { name: s, amount: '' }
}

/** 用量：按 {capacity, daily_ops} 读；也兼容早先的平铺字段；关键字段缺失时返回 null（隐藏用量条） */
export function normStorage(raw: unknown): Storage | null {
  const o = (raw ?? {}) as Record<string, unknown>
  const num = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : null)
  const cap = (o.capacity ?? {}) as Record<string, unknown>
  const ops = (o.daily_ops ?? {}) as Record<string, unknown>
  const used = num(cap.used_bytes) ?? num(o.used_bytes)
  if (used === null) return null
  const limit = num(cap.limit_bytes) ?? num(o.limit_bytes) ?? STORAGE.defaultLimit
  const percent = num(cap.percent) ?? num(o.used_pct) ?? (limit ? Math.round((used / limit) * 1000) / 10 : 0)
  const lv = cap.level
  const level: StorageLevel = lv === 'warn' || lv === 'danger' ? lv : 'ok'
  return {
    store: str(o.store),
    photo_count: num(o.photo_count) ?? 0,
    capacity: {
      used_bytes: used,
      limit_bytes: limit,
      percent,
      level,
      photos_left: num(cap.photos_left) ?? Math.max(0, Math.floor((limit - used) / STORAGE.estPhotoBytes)),
    },
    daily_ops: { used: num(ops.used) ?? num(o.ops_today) ?? 0, limit: num(ops.limit) ?? num(o.ops_limit) ?? 0 },
  }
}
