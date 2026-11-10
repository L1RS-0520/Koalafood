// 上传页本地草稿（需求 v2.4.6 §12-33 第 2 条）：只存文字（菜名、分类、备注、手写内容），照片不存；
// 保留 7 天，过期自动丢掉；上传成功后立即清除。以前版本存在 IndexedDB 里的照片草稿，打开上传页时一并删掉。
// 纯逻辑尽量不依赖 React，scripts/uploadDraft.test.ts 用 node 直接测（storage 可注入）。
import type { CreateMode, RecipeContent } from '../api/types.ts'
import type { EditorMode } from '../components/RecipeEditor'

export const TEXT_KEY = 'koala-canteen:upload-draft:v1'
/** 旧版照片草稿所在的 IndexedDB 库（只有它用过这个库） */
export const OLD_PHOTO_DB = 'koala-canteen'
/** 草稿保留 7 天 */
export const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000

export interface UploadTextDraft {
  name: string
  category: string
  note: string
  mode: CreateMode
  editorMode: EditorMode
  content: RecipeContent
  saved_at: string
}

type KV = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
const ls = (): KV | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** 读草稿；超过 7 天或坏数据就删掉并返回 null */
export function loadText(store: KV | null = ls(), now = Date.now()): UploadTextDraft | null {
  if (!store) return null
  try {
    const raw = store.getItem(TEXT_KEY)
    if (!raw) return null
    const d = JSON.parse(raw) as UploadTextDraft
    const t = Date.parse(d?.saved_at)
    if (!Number.isFinite(t) || now - t > DRAFT_TTL_MS) {
      store.removeItem(TEXT_KEY)
      return null
    }
    return d
  } catch {
    store.removeItem(TEXT_KEY)
    return null
  }
}
export function saveText(d: Omit<UploadTextDraft, 'saved_at'>, store: KV | null = ls(), now = Date.now()) {
  try {
    store?.setItem(TEXT_KEY, JSON.stringify({ ...d, saved_at: new Date(now).toISOString() }))
  } catch {
    /* 存不下就算了，不影响上传 */
  }
}

/** 删掉旧版存在 IndexedDB 里的照片草稿（照片不再暂存）；失败忽略 */
export function purgeOldPhotoDraft(): void {
  try {
    if (typeof indexedDB !== 'undefined') indexedDB.deleteDatabase(OLD_PHOTO_DB)
  } catch {
    /* 忽略 */
  }
}

export function clearDraft(store: KV | null = ls()) {
  try {
    store?.removeItem(TEXT_KEY)
  } catch {
    /* 忽略 */
  }
  purgeOldPhotoDraft()
}

export const hasText = (d: UploadTextDraft | null) =>
  !!d && (!!d.name.trim() || !!d.note.trim() || !!d.category || d.content.ingredients.length + d.content.steps.length + d.content.tips.length > 0)

/** 离开上传页的提示正文（须说明文字会保留、照片要重新选） */
export const LEAVE_UPLOAD_TEXT = '菜名、分类、备注和手写的菜谱会先存在本机，7 天内打开上传页还在；照片得重新选。'
