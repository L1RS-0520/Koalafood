// 上传页本地草稿：文字存 localStorage，已压缩的照片存 IndexedDB；提交成功后清掉
import type { CreateMode, RecipeContent } from '../api'
import type { EditorMode } from '../components/RecipeEditor'

const TEXT_KEY = 'koala-canteen:upload-draft:v1'
const DB = 'koala-canteen'
const STORE = 'upload-photos'

export interface UploadTextDraft {
  name: string
  category: string
  note: string
  mode: CreateMode
  editorMode: EditorMode
  content: RecipeContent
  saved_at: string
}

export function loadText(): UploadTextDraft | null {
  try {
    const raw = localStorage.getItem(TEXT_KEY)
    return raw ? (JSON.parse(raw) as UploadTextDraft) : null
  } catch {
    return null
  }
}
export function saveText(d: Omit<UploadTextDraft, 'saved_at'>) {
  try {
    localStorage.setItem(TEXT_KEY, JSON.stringify({ ...d, saved_at: new Date().toISOString() }))
  } catch {
    /* 存不下就算了，不影响上传 */
  }
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no idb'))
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** 整体覆盖保存照片（按顺序） */
export async function savePhotos(files: File[]): Promise<void> {
  try {
    const db = await open()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      const st = tx.objectStore(STORE)
      st.clear()
      st.put(
        files.map((f) => ({ name: f.name, type: f.type, blob: f })),
        'list',
      )
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch {
    /* IndexedDB 不可用时只存文字 */
  }
}

export async function loadPhotos(): Promise<File[]> {
  try {
    const db = await open()
    const list = await new Promise<{ name: string; type: string; blob: Blob }[] | undefined>((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get('list')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    db.close()
    return (list ?? []).map((x) => new File([x.blob], x.name, { type: x.type }))
  } catch {
    return []
  }
}

export async function clearDraft() {
  try {
    localStorage.removeItem(TEXT_KEY)
  } catch {
    /* 忽略 */
  }
  await savePhotos([])
}

export const hasText = (d: UploadTextDraft | null) =>
  !!d && (!!d.name.trim() || !!d.note.trim() || !!d.category || d.content.ingredients.length + d.content.steps.length + d.content.tips.length > 0)
