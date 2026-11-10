// 浏览器内置 mock 后端（VITE_MOCK=1）：字段、路径语义与 docs/接口约定.md v2.3 一致，数据存 localStorage，刷新不丢。
// 模拟规则：pending 满 20 秒自动出示例草稿；菜名含「失败」则出带 chef_message 的空草稿；菜名含「塞满」上传返回 429 STORAGE_QUOTA；
// 开发开关（localStorage）：koala-canteen:mock:can_edit = "0" 切访客视角；koala-canteen:mock:chef-delay 改出稿时间（毫秒）；
// koala-canteen:mock:storage-used 覆盖已用字节（≥996147200 时上传返回 507 STORAGE_FULL）；koala-canteen:mock:ops-today 覆盖当天写入次数（上限 1000，≥1000 时上传/追加照片返回 429）。
// 菜名含「塞满」→ 429 STORAGE_QUOTA；含「超大」→ 413 TOO_LARGE（模拟第 1 张 1,030KB）。
import { metaErrors, onlyNumberIssue, touchesContent } from '../lib/editPatch'
import { tooLargeText } from '../lib/util'
import { CHEF_STATUS, LIMITS } from './contract'
import { mockDraft } from './mockChef'
import { makeSeed, SEED_PHOTOS, type MockDish, type MockPhoto } from './mockSeed'
import { normDish, normStorage, normSummary } from './normalize'
import { ApiError, CATEGORIES, type Api, type Dish, type DishSummary, type RecipeContent } from './types'

const KEY = 'koala-canteen:mock:v3'
const CAN_EDIT_KEY = 'koala-canteen:mock:can_edit'
const DELAY_KEY = 'koala-canteen:mock:chef-delay'
const STORAGE_KEY = 'koala-canteen:mock:storage-used'
const OPS_KEY = 'koala-canteen:mock:ops-today'

interface Store {
  dishes: MockDish[]
  settings: { chef_enabled: boolean }
}

function load(): Store {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw) as Store
  } catch {
    /* 坏数据就重置 */
  }
  const s: Store = { dishes: makeSeed(), settings: { chef_enabled: localStorage.getItem('koala-canteen:mock:chef-off') !== '1' } }
  save(s)
  return s
}
function save(s: Store) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    throw new ApiError('TOO_LARGE', '浏览器本地空间满了（mock 模式照片存在本地），删几道菜再试', 413)
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const lag = () => sleep(180 + Math.random() * 220)
const now = () => new Date().toISOString()
const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `m-${Date.now()}-${Math.random().toString(16).slice(2)}`

const canEdit = () => localStorage.getItem(CAN_EDIT_KEY) !== '0'
const chefDelay = () => Number(localStorage.getItem(DELAY_KEY)) || 20_000

const photoUrl = (p: MockPhoto) => (p.ref.startsWith('seed:') ? (SEED_PHOTOS[p.ref.slice(5)] ?? '') : p.ref)

/** 模拟厨驼：pending 满 20 秒交稿 */
function tickChef(s: Store): boolean {
  if (!s.settings.chef_enabled) return false
  let changed = false
  for (const d of s.dishes) {
    if (d.chef_status !== CHEF_STATUS.pending || !d.chef_requested_at) continue
    if (Date.now() - Date.parse(d.chef_requested_at) < chefDelay()) continue
    d.draft = mockDraft(d.name, d.category, d.note ?? '', d.requested_note)
    d.chef_status = CHEF_STATUS.draft
    d.updated_at = now()
    changed = true
  }
  if (changed) save(s)
  return changed
}

function toDish(d: MockDish): Dish {
  const photos = d.photos.map((p) => ({ id: p.id, url: photoUrl(p) }))
  const visible = canEdit()
  return normDish({
    ...d,
    photos,
    photo_url: photos[0]?.url ?? '',
    // v2.3 隐私：未登录不返回 draft / requested_note；v2.3.3 起 chef_requested_at 也不返回
    chef_requested_at: visible ? d.chef_requested_at : undefined,
    draft: visible ? d.draft : null,
    requested_note: visible ? d.requested_note : null,
    chef_message: visible ? (d.draft?.chef_message ?? null) : null,
  })
}
function toSummary(d: MockDish): DishSummary {
  return normSummary({ ...d, total_time: d.total_time, photo_url: d.photos[0] ? photoUrl(d.photos[0]) : '', photo_count: d.photos.length })
}

function find(s: Store, id: string): MockDish {
  const d = s.dishes.find((x) => x.id === id)
  if (!d) throw new ApiError('NOT_FOUND', '这道菜找不到了，可能已经被删掉', 404)
  return d
}
function requireLogin() {
  if (!canEdit()) throw new ApiError('UNAUTHORIZED', '这里是后厨，大王登录后才能操作', 401)
}
function requireChef(s: Store) {
  if (!s.settings.chef_enabled) throw new ApiError('CHEF_DISABLED', '厨驼已在设置里关闭，请先打开或改为自己写', 403)
}

function checkPhotos(files: File[], existing = 0) {
  if (files.length + existing < 1) throw new ApiError('VALIDATION', '至少要有 1 张照片', 400)
  if (files.length + existing > LIMITS.photosMax) throw new ApiError('VALIDATION', `最多 ${LIMITS.photosMax} 张照片`, 400)
  files.forEach((f, i) => {
    if (!(LIMITS.photoTypes as readonly string[]).includes(f.type))
      throw new ApiError('BAD_TYPE', '只支持 jpg、png、webp 格式的照片', 415)
    // 和后端同一句（后端审查 P2-6）
    if (f.size > LIMITS.uploadMaxBytes) throw new ApiError('TOO_LARGE', `第 ${i + 1} 张${tooLargeText(f.size)}`, 413)
  })
}

/**
 * 写照片前的额度判断，和真实接口同规则（后端审查 P2-5）：已用 + 本次总字节 > 上限 → 507；
 * 已用次数 + 本次张数 > 上限 → 429；两个都超时先判 507。都在写入前，不留半条。
 */
async function storageGate(name: string, files: File[] = []) {
  const bytes = files.reduce((n, f) => n + f.size, 0)
  if (Number(localStorage.getItem(STORAGE_KEY)) + bytes > 996_147_200) {
    await sleep(400)
    throw new ApiError('STORAGE_FULL', '照片柜满啦，删掉一些旧照片才能继续上传～', 507)
  }
  if (name.includes('塞满') || Number(localStorage.getItem(OPS_KEY)) + Math.max(1, files.length) > 1000) {
    await sleep(400)
    throw new ApiError('STORAGE_QUOTA', '今天食堂的照片柜塞满啦，明天再来传吧～', 429)
  }
  if (name.includes('超大')) {
    await sleep(300)
    throw new ApiError('TOO_LARGE', `第 1 张${tooLargeText(1_054_720)}`, 413)
  }
}

/** mock 里把照片压成 ≤1024px 的 JPEG dataURL 存 localStorage */
async function compress(file: File): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const scale = Math.min(1, 1024 / Math.max(img.naturalWidth, img.naturalHeight))
    const c = document.createElement('canvas')
    c.width = Math.round(img.naturalWidth * scale)
    c.height = Math.round(img.naturalHeight * scale)
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
    return c.toDataURL('image/jpeg', 0.82)
  } finally {
    URL.revokeObjectURL(url)
  }
}

function validateText(name: string, category: string, note?: string | null) {
  if (!name.trim()) throw new ApiError('VALIDATION', '菜名不能为空', 400)
  if ([...name.trim()].length > LIMITS.nameMax) throw new ApiError('VALIDATION', `菜名最多 ${LIMITS.nameMax} 个字`, 400)
  if (!(CATEGORIES as readonly string[]).includes(category)) throw new ApiError('VALIDATION', '请选择分类', 400)
  if (note && [...note].length > LIMITS.noteMax) throw new ApiError('VALIDATION', `备注最多 ${LIMITS.noteMax} 个字`, 400)
}

/** 份量 / 总时长超过 20 字 → 400（和后端 v2.3.3 一致） */
function validateMeta(c: { servings?: string | null; total_time?: string | null }) {
  const errs = metaErrors({ servings: c.servings ?? null, total_time: c.total_time ?? null })
  if (errs.length) throw new ApiError('VALIDATION', errs.join('；'), 400)
}
/** 只写了编号的食材/步骤/小贴士 → 400 VALIDATION + details {field, index, reason:'only_number'}（对齐后端 v2.3.3） */
function validateItems(c: Partial<Pick<RecipeContent, 'ingredients' | 'steps' | 'tips'>>) {
  const it = onlyNumberIssue({ ingredients: c.ingredients ?? [], steps: c.steps ?? [], tips: c.tips ?? [] })
  // 后端 v2.3.3：index 从 1 起，details 里也带 message
  if (it) throw new ApiError('VALIDATION', it.message, 400, { field: it.field, index: it.index + 1, reason: it.reason, message: it.message })
}

const emptyContent = (): RecipeContent => ({ ingredients: [], steps: [], tips: [], servings: null, total_time: null })

export const mockApi: Api = {
  async health() {
    await lag()
    const s = load()
    tickChef(s)
    return {
      ok: true,
      mock: true,
      chef_enabled: s.settings.chef_enabled,
      chef_pending: s.dishes.filter((d) => d.chef_status === CHEF_STATUS.pending).length,
    }
  },

  async me() {
    await lag()
    const v = canEdit()
    return { logged_in: v, can_edit: v, email: v ? 'dawang@koala.local' : null }
  },

  async devLogin() {
    await lag()
    localStorage.setItem(CAN_EDIT_KEY, '1')
    return true
  },
  async devLogout() {
    await lag()
    localStorage.setItem(CAN_EDIT_KEY, '0')
    return true
  },

  async listDishes(category) {
    await lag()
    const s = load()
    tickChef(s)
    return s.dishes
      .filter((d) => !category || category === '全部' || d.category === category)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map(toSummary)
  },

  async getDish(id) {
    await lag()
    const s = load()
    tickChef(s)
    return toDish(find(s, id))
  },

  async createDish(input) {
    requireLogin()
    const s = load()
    validateText(input.name, input.category, input.note)
    if (input.mode === 'manual' && input.content) (validateMeta(input.content), validateItems(input.content))
    checkPhotos(input.photos)
    if (input.mode === 'chef') requireChef(s)
    await storageGate(input.name, input.photos)
    const refs = await Promise.all(input.photos.map(compress))
    await sleep(700)
    const t = now()
    const content = input.mode === 'manual' ? (input.content ?? emptyContent()) : emptyContent()
    const d: MockDish = {
      id: uid(),
      name: input.name.trim(),
      category: input.category,
      note: input.note?.trim() || null,
      photos: refs.map((ref) => ({ id: uid(), ref })),
      chef_status: input.mode === 'chef' ? CHEF_STATUS.pending : CHEF_STATUS.confirmed,
      source: input.mode === 'chef' ? 'chef' : 'manual',
      ...content,
      draft: null,
      requested_note: null,
      chef_requested_at: input.mode === 'chef' ? t : null,
      created_at: t,
      updated_at: t,
    }
    s.dishes.unshift(d)
    save(s)
    return toDish(d)
  },

  async updateDish(id, patch) {
    requireLogin()
    await lag()
    const s = load()
    const d = find(s, id)
    const name = patch.name ?? d.name
    const category = patch.category ?? d.category
    const note = patch.note === undefined ? d.note : patch.note
    validateText(name, category, note)
    validateMeta(patch)
    validateItems(patch)
    Object.assign(d, {
      name: name.trim(),
      category,
      note: note?.trim() || null,
      ingredients: patch.ingredients ?? d.ingredients,
      steps: patch.steps ?? d.steps,
      tips: patch.tips ?? d.tips,
      servings: patch.servings === undefined ? d.servings : patch.servings,
      total_time: patch.total_time === undefined ? d.total_time : patch.total_time,
    })
    // 接口约定 v2.3.2 第 12 条：只有 patch 里出现内容键（ingredients/steps/tips/servings/total_time，值没变也算）
    // 才 → confirmed + source=manual 并作废厨驼任务；只改 name/category/note 时 source、chef_status 都不变
    if (touchesContent(patch)) {
      d.chef_status = CHEF_STATUS.confirmed
      d.source = 'manual'
      d.draft = null
      d.chef_requested_at = null
      d.requested_note = null
    }
    d.updated_at = now()
    save(s)
    return toDish(d)
  },

  async addPhotos(id, files) {
    requireLogin()
    const s = load()
    const d = find(s, id)
    checkPhotos(files, d.photos.length)
    await storageGate(d.name, files)
    const refs = await Promise.all(files.map(compress))
    await lag()
    d.photos.push(...refs.map((ref) => ({ id: uid(), ref })))
    d.updated_at = now()
    save(s)
    return toDish(d)
  },

  async deletePhoto(id, photoId) {
    requireLogin()
    await lag()
    const s = load()
    const d = find(s, id)
    if (d.photos.length <= 1) throw new ApiError('VALIDATION', '至少要留 1 张照片', 400)
    d.photos = d.photos.filter((p) => p.id !== photoId)
    d.updated_at = now()
    save(s)
    return toDish(d)
  },

  async reorderPhotos(id, ids) {
    requireLogin()
    await lag()
    const s = load()
    const d = find(s, id)
    if (ids.length !== d.photos.length || !ids.every((x) => d.photos.some((p) => p.id === x)))
      throw new ApiError('VALIDATION', '照片顺序和现有照片对不上，刷新一下再试', 400)
    d.photos = ids.map((x) => d.photos.find((p) => p.id === x)!)
    save(s)
    return toDish(d)
  },

  async deleteDish(id) {
    requireLogin()
    await lag()
    const s = load()
    find(s, id)
    s.dishes = s.dishes.filter((d) => d.id !== id)
    save(s)
  },

  async askChef(id, note) {
    requireLogin()
    await lag()
    const s = load()
    requireChef(s)
    const d = find(s, id)
    d.chef_status = CHEF_STATUS.pending
    d.draft = null
    d.requested_note = note?.trim() || null
    d.chef_requested_at = now()
    d.updated_at = now()
    save(s)
    return toDish(d)
  },

  async confirmDraft(id, content) {
    requireLogin()
    await lag()
    const s = load()
    const d = find(s, id)
    if (d.chef_status !== CHEF_STATUS.draft || !d.draft)
      throw new ApiError('BAD_STATE', '这份草稿已经不在了（状态刚刚变了），已为你刷新', 409)
    const c = content ?? d.draft
    if (content) (validateMeta(content), validateItems(content))
    Object.assign(d, {
      ingredients: c.ingredients,
      steps: c.steps,
      tips: c.tips,
      servings: c.servings,
      total_time: c.total_time,
      chef_status: CHEF_STATUS.confirmed,
      source: 'chef',
      draft: null,
      requested_note: null,
      chef_requested_at: null,
      updated_at: now(),
    })
    save(s)
    return toDish(d)
  },

  async discardDraft(id) {
    requireLogin()
    await lag()
    const s = load()
    const d = find(s, id)
    if (d.chef_status !== CHEF_STATUS.draft) throw new ApiError('BAD_STATE', '这份草稿已经不在了，已为你刷新', 409)
    Object.assign(d, { chef_status: CHEF_STATUS.confirmed, draft: null, requested_note: null, chef_requested_at: null, updated_at: now() })
    save(s)
    return toDish(d)
  },

  async getStorage() {
    await lag()
    if (!canEdit()) return null
    const s = load()
    const photos = s.dishes.flatMap((d) => d.photos)
    // 示例图按 130KB 计，上传的按 dataURL 长度估算；可用开发开关覆盖已用字节数（截图 80%/95% 用）
    const real = photos.reduce((n, p) => n + (p.ref.startsWith('seed:') ? 130_000 : Math.round(p.ref.length * 0.75)), 0)
    const used = Number(localStorage.getItem(STORAGE_KEY)) || real
    const limit = 996_147_200
    const percent = Math.round((used / limit) * 1000) / 10
    return normStorage({
      store: 'kv', // mock 模拟默认的 KV 存储（次数提示只对 kv 显示）
      photo_count: photos.length,
      capacity: {
        used_bytes: used,
        limit_bytes: limit,
        percent,
        // 档位按原始比例判断（percent 只是四舍五入的显示值）
        level: used / limit >= 0.95 ? 'danger' : used / limit >= 0.8 ? 'warn' : 'ok',
        photos_left: Math.max(0, Math.floor((limit - used) / 512_000)),
      },
      daily_ops: { used: Number(localStorage.getItem(OPS_KEY)) || 12, limit: 1000 },
    })
  },

  async getSettings() {
    await lag()
    return { ...load().settings }
  },

  async updateSettings(st) {
    requireLogin()
    await lag()
    const s = load()
    s.settings.chef_enabled = st.chef_enabled
    save(s)
    return { ...s.settings }
  },
}

/** 给开发/截图用：重置 mock 数据 */
export function resetMock(empty = false) {
  const s: Store = { dishes: empty ? [] : makeSeed(), settings: { chef_enabled: true } }
  save(s)
}
