// P2 上传页（仅大王）：多图 + 菜名/分类/备注 + 写法「找厨驼写」(默认) /「自己写」
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api, ApiError, CATEGORIES, CREATE_MODE, LIMITS, type CreateMode, type RecipeContent } from '../api'
import { BasicFields, validateBasics, type BasicErrors, type Basics } from '../components/BasicFields'
import { ChefLlama } from '../components/ChefLlama'
import { Icon } from '../components/Icon'
import { Koala } from '../components/Koala'
import { PhotoManager, type PhotoItem } from '../components/PhotoManager'
import { FullDialog, QuotaBanner, StorageWarn, useStorage } from '../components/StorageMeter'
import { cleanContent, emptyContent, RecipeEditor, type EditorIssue, type EditorMode } from '../components/RecipeEditor'
import { BusyOverlay, Confirm, LeaveGuard, TopBar, Spinner } from '../components/ui'
import { useApp } from '../lib/app'
import { useTitle, useUnsavedGuard } from '../lib/hooks'
import { clearDraft, hasText, LEAVE_UPLOAD_TEXT, loadText, purgeOldPhotoDraft, saveText } from '../lib/uploadDraft'
import { compressImage, compressProblem, CompressError, mb1, precheckPhoto, PROBLEM_TEXT, type PhotoProblem } from '../lib/compress'
import { fieldIssueOf, metaErrors, rawIndexOf } from '../lib/editPatch'
import { cx, photoIndexOf, tooLargeText } from '../lib/util'

interface LocalPhoto extends PhotoItem {
  /** 要上传的文件：压缩完是压缩后的；不合格的是原文件（不会上传） */
  file: File
}

/** mock 模式专用：文件名含「压不下」时模拟“压缩后仍 1.3MB”（设计 ③），方便本地预览和自测；线上不生效 */
const MOCK_TOO_BIG = import.meta.env.MODE === 'mock' ? '压不下' : null

/** 保存按钮在有红图时的文案（设计 ①③：1 张写“先换掉第 N 张照片”，多张写“先换掉 N 张有问题的照片”） */
export function badButtonText(badIdx: number[]): string {
  return badIdx.length === 1 ? `先换掉第 ${badIdx[0] + 1} 张照片` : `先换掉 ${badIdx.length} 张有问题的照片`
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
  const [issue, setIssue] = useState<EditorIssue | null>(null) // 后端逐条校验错误（v2.3.3 details）

  const [serverBad, setServerBad] = useState<Record<string, string>>({})

  // 厨驼关掉时只有手写
  const effMode: CreateMode = app.chefEnabled ? mode : CREATE_MODE.manual

  useEffect(() => () => photos.forEach((p) => URL.revokeObjectURL(p.url)), []) // eslint-disable-line react-hooks/exhaustive-deps

  // —— 本地草稿（v2.4.6 §12-33 第 2 条）：只恢复文字，照片不暂存；7 天过期；旧版存在 IndexedDB 的照片一并删掉 ——
  const [restored, setRestored] = useState(false)
  useEffect(() => {
    purgeOldPhotoDraft()
    const t = loadText()
    if (hasText(t) && t) {
      setBasics({ name: t.name, category: t.category, note: t.note })
      setMode(t.mode)
      setContent(t.content)
      setEditorMode(t.editorMode)
      app.toast('已恢复上次填的文字，照片要重新选', 'info')
    } else if (presetCategory) setBasics((b) => ({ ...b, category: presetCategory }))
    setRestored(true)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!restored || done) return
    const t = setTimeout(() => saveText({ ...basics, mode, editorMode, content }), 300)
    return () => clearTimeout(t)
  }, [basics, mode, editorMode, content, restored, done])
  const [askClear, setAskClear] = useState(false)
  const clearAll = async () => {
    photos.forEach((p) => p.url && URL.revokeObjectURL(p.url))
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
  const patch = (key: string, p: Partial<LocalPhoto>) => setPhotos((ps) => ps.map((x) => (x.key === key ? { ...x, ...p } : x)))
  /**
   * 选图：每张先预检（HEIC / 格式 / 超 10MB），不合格的直接进网格标红；合格的先“排队中”占位，再逐张压缩。
   * 压完仍 >1MB 或打不开的也标红留在网格里，不上传，可以删。超过 9 张的部分不加入，给一句提示。
   */
  const addFiles = async (files: File[]) => {
    const room = LIMITS.photosMax - photos.length
    const take = files.slice(0, Math.max(0, room))
    // 设计 §5.5：超过 9 张时提示“有 1 张没加进来：最多 9 张照片哦”
    const over = files.length - take.length
    const overText = over > 0 ? `有 ${over} 张没加进来：最多 ${LIMITS.photosMax} 张照片哦` : null
    setPhotoErr(overText)
    if (overText) app.toast(overText, 'info')
    if (!take.length) return
    const stamp = Date.now()
    const added: LocalPhoto[] = take.map((f, i) => {
      const problem = precheckPhoto(f)
      return {
        key: `${stamp}-${i}-${f.name}`,
        url: problem?.noPreview ? '' : URL.createObjectURL(f),
        name: f.name,
        file: f,
        originalSize: f.size,
        problem,
        status: problem ? undefined : 'queued',
      }
    })
    setPhotos((ps) => [...ps, ...added])
    const queue = added.filter((p) => !p.problem)
    if (!queue.length) return
    setProgress({ done: 0, total: queue.length })
    for (let n = 0; n < queue.length; n++) {
      const it = queue[n]
      patch(it.key, { status: 'compressing', pct: 0 })
      try {
        if (MOCK_TOO_BIG && it.file.name.includes(MOCK_TOO_BIG)) throw new CompressError('TOO_BIG', 'mock', Math.round(1.3 * 1024 * 1024))
        const r = await compressImage(it.file, (pct) => patch(it.key, { pct }))
        const url = URL.createObjectURL(r.file)
        URL.revokeObjectURL(it.url)
        patch(it.key, { file: r.file, url, size: r.file.size, status: undefined, pct: undefined })
      } catch (e) {
        const problem: PhotoProblem = compressProblem(it.file.name, e)
        if (problem.noPreview) URL.revokeObjectURL(it.url)
        patch(it.key, { problem, status: undefined, pct: undefined, url: problem.noPreview ? '' : it.url })
      }
      setProgress({ done: n + 1, total: queue.length })
    }
    setProgress(null)
  }
  const removePhoto = (key: string) =>
    setPhotos((ps) => {
      const p = ps.find((x) => x.key === key)
      if (p?.url) URL.revokeObjectURL(p.url)
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

  /** 每张照片的问题：选图/压缩时标的 → 上传时 413 标的 → 兜底检查（压缩后应 ≤1MB 且为 webp/jpeg/png） */
  const problemOf = (p: LocalPhoto): PhotoProblem | null => {
    if (p.problem) return p.problem
    if (serverBad[p.key]) return { kind: 'serverTooLarge', tag: PROBLEM_TEXT.tagServerTooLarge, detail: serverBad[p.key], meta: `${p.name ?? p.file.name} · ${mb1(p.file.size)}` }
    if (p.status) return null
    if (!['image/webp', 'image/jpeg', 'image/png'].includes(p.file.type))
      return { kind: 'type', tag: PROBLEM_TEXT.tagType, detail: `「${p.name ?? p.file.name}」格式不对，换一张吧`, noPreview: true }
    if (p.file.size > LIMITS.uploadMaxBytes)
      return { kind: 'compressedTooBig', tag: `压完 ${mb1(p.file.size)}`, detail: PROBLEM_TEXT.compressedTooBig, meta: `${p.name ?? p.file.name} · 压缩后 ${mb1(p.file.size)}` }
    return null
  }
  const badIdx = photos.map((p, i) => (problemOf(p) ? i : -1)).filter((i) => i >= 0)
  const badCount = badIdx.length
  const validate = (): BasicErrors => {
    const e = validateBasics(basics)
    const good = photos.filter((p) => !problemOf(p))
    if (photos.length === 0) e.photos = '至少要传 1 张照片'
    else if (progress || photos.some((p) => p.status)) e.photos = '照片还在压缩，稍等一下'
    else if (!good.length) e.photos = '至少要有 1 张能用的照片'
    return e
  }
  // 提交过一次后，实时更新错误
  useEffect(() => {
    if (tried.current) setErrors(validate())
  }, [basics, photos]) // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    // 还有红图：不提交，提示并带到照片区（按钮看起来是灰的，但点了要有反应）
    if (badCount > 0) {
      app.toast(`${badButtonText(badIdx)}，删掉或换一张就能保存`, 'err')
      document.getElementById('f-photos')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
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
      // 自己写时“第 N 步只写了编号”这类：滚到那一条、一直显示说明，不只闪 toast
      const fi = effMode === CREATE_MODE.manual ? fieldIssueOf(err) : null
      const row = fi ? rawIndexOf(content, fi.field, fi.index) : -1
      if (fi && row >= 0) {
        setIssue({ field: fi.field, index: row, message: fi.message })
        return
      }
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
          idx.forEach((i) => photos[i] && (marks[photos[i].key] = `${tooLargeText(photos[i].file.size)}，删掉换一张吧`))
          setServerBad(marks)
          setPhotoErr(idx.length ? null : tooLargeText(null))
        } else setPhotoErr(err.message)
        document.getElementById('f-photos')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    } finally {
      setBusy(false)
    }
  }

  const photoItems = useMemo<PhotoItem[]>(
    () =>
      photos.map((p) => ({
        key: p.key,
        url: p.url,
        name: p.name ?? p.file.name,
        size: p.status ? undefined : p.size,
        originalSize: p.originalSize,
        status: p.status,
        pct: p.pct,
        problem: problemOf(p),
      })),
    [photos, serverBad], // eslint-disable-line react-hooks/exhaustive-deps
  )

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
            <RecipeEditor
              value={content}
              onChange={setContent}
              mode={editorMode}
              onModeChange={setEditorMode}
              title="食材和步骤"
              issue={issue}
              onIssueClear={() => setIssue(null)}
            />
          )}
        </section>

        <div className="submit-bar">
          <button
            type="submit"
            disabled={busy || !!progress}
            aria-disabled={badCount > 0 || undefined}
            className={cx('btn btn--primary btn--lg btn--block', badCount > 0 && 'is-blocked')}
          >
            {progress ? (
              <>
                <Spinner />
                正在压缩照片…（{progress.done}/{progress.total}）
              </>
            ) : badCount > 0 ? (
              <>{badButtonText(badIdx)}</>
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
      <LeaveGuard blocker={blocker} title="这道菜还没上传，要离开吗？" body={LEAVE_UPLOAD_TEXT} okText="先离开" />
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
