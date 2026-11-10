// 真实后端：/api 由 vite 代理到本地 worker（8787），线上同源
import { CREATE_MODE, PATHS, PHOTO_FIELD, SETTINGS_FIELD } from './contract'
import { normDish, normStorage, normSummary } from './normalize'
import { ApiError, type Api, type Health, type NewDishInput, } from './types'

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, { ...init, headers: { Accept: 'application/json', ...init.headers } })
  } catch {
    throw new ApiError('NETWORK', '连不上考拉食堂的后厨，检查一下网络再试试', 0)
  }
  const text = await res.text()
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = null
  }
  if (!res.ok) {
    const err = (body as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error
    const fallback: Record<number, string> = {
      401: '这里是后厨，大王登录后才能操作',
      403: '厨驼已在设置里关闭，请先打开或改为自己写',
      404: '这道菜找不到了，可能已经被删掉',
      409: '这道菜的状态刚刚变了，刷新一下再试',
      413: '照片太大了，上限 1,024KB', // = tooLargeText(null)，和约定 §2 同格式
      429: '今天食堂的照片柜塞满啦，明天再来传吧～',
      507: '照片柜满啦，删掉一些旧照片才能继续上传～',
      415: '只支持 jpg、png、webp 格式的照片',
    }
    throw new ApiError(
      err?.code ?? (res.status === 404 ? 'NOT_FOUND' : 'INTERNAL'),
      err?.message ?? fallback[res.status] ?? `后厨出了点状况（${res.status}），稍后再试`,
      res.status,
      err?.details,
    )
  }
  return body as T
}

const json = (method: string, data: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data ?? {}),
})

export const httpApi: Api = {
  health: () => request<Health>(PATHS.health),

  async me() {
    try {
      const r = await request<Record<string, unknown>>(PATHS.me)
      const logged = r?.logged_in === true || r?.can_edit === true
      return { logged_in: logged, can_edit: r?.can_edit === true || logged, email: typeof r?.email === 'string' ? r.email : null }
    } catch (e) {
      // 401/403 视为访客
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) return { logged_in: false, can_edit: false, email: null }
      throw e
    }
  },

  async listDishes(category) {
    const q = category && category !== '全部' ? `?category=${encodeURIComponent(category)}` : ''
    const r = await request<{ dishes?: unknown[] }>(`${PATHS.dishes}${q}`, { cache: 'no-store' })
    return (r?.dishes ?? []).map(normSummary)
  },

  getDish: async (id) => normDish(await request(PATHS.dish(id), { cache: 'no-store' })),

  async createDish(input: NewDishInput) {
    const fd = new FormData()
    fd.set('name', input.name)
    fd.set('category', input.category)
    for (const f of input.photos) fd.append(PHOTO_FIELD, f)
    if (input.note) fd.set('note', input.note)
    fd.set('mode', input.mode)
    if (input.mode === CREATE_MODE.manual && input.content) {
      const c = input.content
      fd.set('ingredients', JSON.stringify(c.ingredients))
      fd.set('steps', JSON.stringify(c.steps))
      fd.set('tips', JSON.stringify(c.tips))
      if (c.servings) fd.set('servings', c.servings)
      if (c.total_time) fd.set('total_time', c.total_time)
    }
    return normDish(await request(PATHS.createDish, { method: 'POST', body: fd }))
  },

  updateDish: async (id, patch) => normDish(await request(PATHS.updateDish(id), json('PATCH', patch))),

  async addPhotos(id, photos) {
    const fd = new FormData()
    for (const f of photos) fd.append(PHOTO_FIELD, f)
    return normDish(await request(PATHS.addPhotos(id), { method: 'POST', body: fd }))
  },

  deletePhoto: async (id, photoId) => normDish(await request(PATHS.deletePhoto(id, photoId), { method: 'DELETE' })),
  reorderPhotos: async (id, ids) => normDish(await request(PATHS.photoOrder(id), json('PUT', { ids }))),

  async devLogin() {
    try {
      await request(PATHS.devLogin, json('POST', {}))
      return true
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return false
      throw e
    }
  },
  async devLogout() {
    try {
      await request(PATHS.devLogout, json('POST', {}))
      return true
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return false
      throw e
    }
  },

  async deleteDish(id) {
    await request(PATHS.deleteDish(id), { method: 'DELETE' })
  },

  askChef: async (id, note) => normDish(await request(PATHS.askChef(id), json('POST', note ? { note } : {}))),
  confirmDraft: async (id, content) => normDish(await request(PATHS.confirm(id), json('POST', content ?? {}))),
  discardDraft: async (id) => normDish(await request(PATHS.discardDraft(id), json('POST', {}))),

  async getStorage() {
    try {
      const r = await request<Record<string, unknown>>(PATHS.storage, { cache: 'no-store' })
      return normStorage(r)
    } catch (e) {
      if (e instanceof ApiError && [401, 403, 404].includes(e.status)) return null
      throw e
    }
  },

  async getSettings() {
    const r = await request<Record<string, unknown>>(PATHS.settings)
    return { chef_enabled: r?.[SETTINGS_FIELD] !== false }
  },
  async updateSettings(st) {
    const r = await request<Record<string, unknown>>(PATHS.updateSettings, json('PATCH', { [SETTINGS_FIELD]: st.chef_enabled }))
    return { chef_enabled: r?.[SETTINGS_FIELD] !== false }
  },
}
