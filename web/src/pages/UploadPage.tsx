// P2 上传页（仅大王）：多图 + 菜名/分类/备注 + 写法「找厨驼写」(默认) /「自己写」
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api, ApiError, CATEGORIES, CREATE_MODE, LIMITS, type CreateMode, type RecipeContent } from '../api'
import { BasicFields, validateBasics, type BasicErrors, type Basics } from '../components/BasicFields'
import { ChefLlama } from '../components/ChefLlama'
import { Icon } from '../components/Icon'
import { Koala } from '../components/Koala'
import { checkFiles, PhotoManager, type PhotoItem } from '../components/PhotoManager'
import { FullDialog, QuotaBanner, StorageWarn, useStorage } from '../components/StorageMeter'
import { cleanContent, emptyContent, RecipeEditor, type EditorMode } from '../components/RecipeEditor'
import { BusyOverlay, Confirm, LeaveGuard, TopBar, Spinner } from '../components/ui'
import { useApp } from '../lib/app'
import { useTitle, useUnsavedGuard } from '../lib/hooks'
import { clearDraft, hasText, loadPhotos, loadText, savePhotos, saveText } from '../lib/uploadDraft'
import { compressAll } from '../lib/compress'
import { metaErrors } from '../lib/editPatch'
import { cx, photoIndexOf, tooLargeText } from '../lib/util'

interface LocalPhoto extends PhotoItem {
  file: File
}

export function UploadPage() {
  useTitle('上传新菜')
  const app = useApp()
  const nav = useNavigate()
  // 从首页空分类点「上传新菜」进来时带 ?category=，预选这个分类（本机有没传完的内容时以恢复的为准）
  const [params] = useSearchParams()
  const presetCategory = (CATEGORIES as readonly string[]).includes(params.get('category') ?? '') ? params.get('category')! : ''
  const [photos, setPhotos] = useState<LocalPhoto[]>([])
  const [photoErr, setPhotoErr] = useState<string | null>(null)
  const [basics, setBasics] = useState<Basics>({ name: '', category: '', note: '' })
  const [mode, setMode] = useState<CreateMode>(CREATE_MODE.chef)
  const [content, setContent] = useState<RecipeContent>(emptyContent())
  const [editorMode, setEditorMode] = useState<EditorMode>('quick')
  const [errors, setErrors] = useState<BasicErrors>({})
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const tried = useRef(false)
  const [storage, reloadStorage] = useStorage(app.canEdit)
  /** 429：顶部提示条；507：弹框；413：标在对应那张上 */
  const [quota, setQuota] = useState(false)
  const [full, setFull] = useState(false)
  const [got507, setGot507] = useState(false) // v2.4.6 §12-33-1：收到 507 后红条立刻改“满啦”

  const [serverBad, setServerBad] = useState<Record<string, string>>({})

  // 厨驼关掉时只有手写
  const effMode: CreateMode = app.chefEnabled ? mode : CREATE_MODE.manual

  useEffect(() => () => photos.forEach((p) => URL.revokeObjectURL(p.url)), []) // eslint-disable-line react-hooks/exhaustive-deps

  // —— 本地草稿：打开时恢复，改动时自动存 ——
  const [restored, setRestored] = useState(false)
  useEffect(() => {
    let alive = true
    ;(async () => {
      const t = loadText()
      const files = await loadPhotos()
      if (!alive) return
      if (hasText(t) && t) {
        setBasics({ name: t.name, category: t.category, note: t.note })
        setMode(t.mode)
        setContent(t.content)
        setEditorMode(t.editorMode)
      }
      if (files.length) setPhotos(files.map((f, i) => ({ key: `r-${i}-${f.name}`, url: URL.createObjectURL(f), file: f })))
      if (hasText(t) || files.length) app.toast('已恢复上次没传完的内容', 'info')
      else if (presetCategory) setBasics((b) => ({ ...b, category: presetCategory }))
      setRestored(true)
    })()
    return () => {
      alive = false
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!restored || done) return
    const t = setTimeout(() => saveText({ ...basics, mode, editorMode, content }), 300)
    return () => clearTimeout(t)
  }, [basics, mode, editorMode, content, restored, done])
  useEffect(() => {
    if (restored && !done) savePhotos(photos.map((p) => p.file))
  }, [photos, restored, done])
  const [askClear, setAskClear] = useState(false)
  const clearAll = async () => {
    photos.forEach((p) => URL.revokeObjectURL(p.url))
    setPhotos([])
    setBasics({ name: '', category: '', note: '' })
    setContent(emptyContent())
    setErrors({})
    setPhotoErr(null)
    tried.current = false
    await clearDraft()
    setAskClear(false)
    app.toast('已清空', 'info')
  }

  const dirty =
    !done &&
    (photos.length > 0 || !!basics.name.trim() || !!basics.note.trim() || content.ingredients.length + content.steps.length + content.tips.length > 0)
  const blocker = useUnsavedGuard(dirty && !busy)

  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const addFiles = async (files: File[]) => {
    const { ok, errors: errs } = checkFiles(files, photos.length)
    setPhotoErr(errs.length ? errs.join('；') : null)
    if (!ok.length) return
    const r = await compressAll(ok, (done, total) => setProgress({ done, total }))
    setProgress(null)
    const all = [...errs, ...r.errors]
    setPhotoErr(all.length ? all.join('；') : null)
    if (r.files.length) {
      setPhotos((ps) => [...ps, ...r.files.map((f, i) => ({ key: `${Date.now()}-${i}-${f.name}`, url: URL.createObjectURL(f), file: f }))])
    }
  }
  const removePhoto = (key: string) =>
    setPhotos((ps) => {
      const p = ps.find((x) => x.key === key)
      if (p) URL.revokeObjectURL(p.url)
      setServerBad((m) => {
        const n = { ...m }
        delete n[key]
        return n
      })
      return ps.filter((x) => x.key !== key)
    })
  const movePhoto = (from: number, to: number) =>
    setPhotos((ps) => {
      if (to < 0 || to >= ps.length) return ps
      const n = ps.slice()
      const [it] = n.splice(from, 1)
      n.splice(to, 0, it)
      return n
    })

  /** 提交前逐张校验（压缩后应 ≤1MB 且为 webp/jpeg/png），不合格的标在那张图上 */
  const badOf = (f: File): string | null => {
    if (!['image/webp', 'image/jpeg', 'image/png'].includes(f.type)) return '格式不对'
    if (f.size > LIMITS.uploadMaxBytes) return '超过 1MB'
    return null
  }
  const validate = (): BasicErrors => {
    const e = validateBasics(basics)
    if (photos.length === 0) e.photos = progress ? '照片还在压缩，稍等一下' : '至少要传 1 张照片'
    else {
      const bad = photos.map((p, i) => [i, badOf(p.file)] as const).filter(([, b]) => b)
      if (bad.length) e.photos = `第 ${bad.map(([i]) => i + 1).join('、')} 张照片不合格，删掉换一张吧`
    }
    return e
  }
  // 提交过一次后，实时更新错误
  useEffect(() => {
    if (tried.current) setErrors(validate())
  }, [basics, photos]) // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    tried.current = true
    const e = validate()
    setErrors(e)
    const first = (['photos', 'name', 'category', 'note'] as const).find((k) => e[k])
    if (first) {
      const el = document.getElementById(first === 'photos' ? 'f-photos' : `f-${first}`)
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.focus({ preventScroll: true })
      app.toast('还有必填项没填好', 'err')
      return
    }
    if (progress) {
      app.toast('照片还在压缩，稍等一下', 'info')
      return
    }
    // 份量 / 总时长最多 20 字（自己写时才有）
    const metaErr = effMode === CREATE_MODE.manual ? metaErrors(content) : []
    if (metaErr.length) {
      app.toast(metaErr[0], 'err')
      return
    }
    setBusy(true)
    try {
      const dish = await api.createDish({
        name: basics.name.trim(),
        category: basics.category,
        note: basics.note.trim() || undefined,
        photos: photos.map((p) => p.file),
        mode: effMode,
        content: effMode === CREATE_MODE.manual ? cleanContent(content) : undefined,
      })
      setDone(true)
      await clearDraft()
      app.toast(effMode === CREATE_MODE.chef ? '交给厨驼啦，写好会自动出现' : '上菜成功！', 'ok')
      // 等 done 生效后再跳，避免被离开拦截
      setTimeout(() => nav(`/dishes/${encodeURIComponent(dish.id)}`, { replace: true }), 0)
    } catch (err) {
      const code = app.handleError(err, '上传没成功，再试一次')
      if (code === 'STORAGE_QUOTA') {
        setQuota(true)
        window.scrollTo({ top: 0, behavior: 'smooth' })
      }
      if (code === 'STORAGE_FULL') {
        setFull(true)
        setGot507(true)
        reloadStorage()
      }
      if (code === 'CHEF_DISABLED') {
        // 厨驼被关了：自动切手写，填的东西都在
        setMode(CREATE_MODE.manual)
      }
      if (err instanceof ApiError && (err.code === 'BAD_TYPE' || err.code === 'TOO_LARGE')) {
        if (err.code === 'TOO_LARGE') {
          // 标出是第几张：优先用后端 message 里的“第 N 张”，否则找本地超过 1MB 的
          const n = photoIndexOf(err.message)
          const idx = n ? [n - 1] : photos.map((p, i) => (p.file.size > LIMITS.uploadMaxBytes ? i : -1)).filter((i) => i >= 0)
          const marks: Record<string, string> = {}
          idx.forEach((i) => photos[i] && (marks[photos[i].key] = '超过 1MB'))
          setServerBad(marks)
          setPhotoErr(
            idx.length
              ? idx.map((i) => `第 ${i + 1} 张：${tooLargeText(photos[i]?.file.size)}，删掉换一张吧`).join('；')
              : tooLargeText(null),
          )
        } else setPhotoErr(err.message)
        document.getElementById('f-photos')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    } finally {
      setBusy(false)
    }
  }

  const photoItems = useMemo(
    () => photos.map(({ key, url, file }) => ({ key, url, size: file.size, bad: serverBad[key] ?? (tried.current ? badOf(file) : null) })),
    [photos, errors, serverBad], // eslint-disable-line react-hooks/exhaustive-deps
  )

  const badCount = photoItems.filter((p) => p.bad).length

  return (
    <main className="page page--form">
      <TopBar
        title="上传新菜"
        right={
          dirty ? (
            <button type="button" className="topbar-text-btn" onClick={() => setAskClear(true)}>
              清空
            </button>
          ) : undefined
        }
      />
      <form
        className="form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        {quota && <QuotaBanner page="upload" onClose={() => setQuota(false)} />}
        <StorageWarn s={storage} got507={got507} />
        <section className="form-card" id="f-photos" aria-labelledby="h-photos">
          <h2 className="form-card-title" id="h-photos">
            <span className="step-badge">1</span>拍下这道菜 <i className="req">至少 1 张</i>
          </h2>
          <PhotoManager
            items={photoItems}
            onAdd={addFiles}
            onRemove={removePhoto}
            onMove={movePhoto}
            error={errors.photos ?? photoErr}
            invalid={!!errors.photos}
            busy={!!progress}
            progress={progress}
          />
        </section>

        <section className="form-card" aria-labelledby="h-basic">
          <h2 className="form-card-title" id="h-basic">
            <span className="step-badge">2</span>它叫什么
          </h2>
          <BasicFields value={basics} onChange={setBasics} errors={errors} />
        </section>

        <section className="form-card" aria-labelledby="h-mode">
          <h2 className="form-card-title" id="h-mode">
            <span className="step-badge">3</span>
            {app.chefEnabled ? '菜谱谁来写？' : '写下菜谱'}
          </h2>
          {app.chefEnabled && (
            <div className="mode-pick" role="radiogroup" aria-label="写法">
              <button
                type="button"
                role="radio"
                aria-checked={effMode === CREATE_MODE.chef}
                className={cx('mode-card', 'mode-card--chef', effMode === CREATE_MODE.chef && 'on')}
                onClick={() => setMode(CREATE_MODE.chef)}
              >
                <ChefLlama pose="write" size={64} animated={effMode === CREATE_MODE.chef} />
                <span className="mode-name">找厨驼写</span>
                <span className="mode-desc">交给厨驼，几分钟后出草稿，你确认就行</span>
                <span className="mode-check" aria-hidden="true">
                  <Icon name="check" size={16} />
                </span>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={effMode === CREATE_MODE.manual}
                className={cx('mode-card', 'mode-card--self', effMode === CREATE_MODE.manual && 'on')}
                onClick={() => setMode(CREATE_MODE.manual)}
              >
                <Koala pose="taste" size={56} />
                <span className="mode-name">自己写</span>
                <span className="mode-desc">随手记几行，空着也能存</span>
                <span className="mode-check" aria-hidden="true">
                  <Icon name="check" size={16} />
                </span>
              </button>
            </div>
          )}
          {effMode === CREATE_MODE.chef ? (
            <div className="chef-note">
              <p>
                厨驼会看菜名、<b>全部照片</b>和备注来写食材和步骤。想要什么口味、做法有啥不同，写在备注里就行。
              </p>
            </div>
          ) : (
            <RecipeEditor value={content} onChange={setContent} mode={editorMode} onModeChange={setEditorMode} title="食材和步骤" />
          )}
        </section>

        <div className="submit-bar">
          <button type="submit" className="btn btn--primary btn--lg btn--block" disabled={busy || !!progress || badCount > 0}>
            {progress ? (
              <>
                <Spinner />
                正在压缩照片…（{progress.done}/{progress.total}）
              </>
            ) : badCount > 0 ? (
              <>先换掉 {badCount} 张有问题的照片</>
            ) : effMode === CREATE_MODE.chef ? (
              <>
                <Icon name="chef" size={22} />
                交给厨驼写！
              </>
            ) : (
              <>
                <Icon name="check" size={22} />
                保存这道菜
              </>
            )}
          </button>
        </div>
      </form>
      <BusyOverlay show={busy} text={effMode === CREATE_MODE.chef ? '正在把菜送进后厨…' : '正在上菜…'} />
      <LeaveGuard blocker={blocker} title="这道菜还没上传，要离开吗？" body="填好的内容会先存在本机，下次打开上传页还在。" okText="先离开" />
      <Confirm
        open={askClear}
        title="清空这次填的内容？"
        body="照片、菜名、备注和菜谱都会清掉，本机存的草稿也一起删。"
        okText="清空"
        danger
        onOk={clearAll}
        onCancel={() => setAskClear(false)}
      />
      <FullDialog open={full} onClose={() => setFull(false)} />
    </main>
  )
}
