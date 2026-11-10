// P4 编辑页（仅大王）：所有字段 + 照片增删排序 + 食材步骤编辑区；?confirm=1 为「修改后确认」草稿
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, ApiError, BODY_TOO_LARGE_TEXT, CHEF_STATUS, CONFIRMED_TEXT, isEmptyContent, LIMITS, type Dish, type RecipeContent } from '../api'
import { BasicFields, validateBasics, type BasicErrors, type Basics } from '../components/BasicFields'
import { ChefLlama } from '../components/ChefLlama'
import { Icon } from '../components/Icon'
import { checkFiles, PhotoManager } from '../components/PhotoManager'
import { FullDialog, QuotaBanner, StorageWarn, useStorage } from '../components/StorageMeter'
import { cleanContent, RecipeEditor, type EditorIssue, type EditorMode } from '../components/RecipeEditor'
import { BusyOverlay, LeaveGuard, PageLoading, StatePanel, TopBar } from '../components/ui'
import { useApp } from '../lib/app'
import { diffPatch, fieldIssueOf, metaErrors, rawIndexOf, touchesContent } from '../lib/editPatch'
import { compressAll } from '../lib/compress'
import { useTitle, useUnsavedGuard } from '../lib/hooks'
import { photoIndexOf, tooLargeText } from '../lib/util'

const snap = (b: Basics, c: RecipeContent) => JSON.stringify([b, cleanContent(c)])

export function EditPage() {
  const { id = '' } = useParams()
  const [params] = useSearchParams()
  const confirmMode = params.get('confirm') === '1'
  const app = useApp()
  const nav = useNavigate()
  const [dish, setDish] = useState<Dish | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [basics, setBasics] = useState<Basics>({ name: '', category: '', note: '' })
  const [content, setContent] = useState<RecipeContent | null>(null)
  const [initial, setInitial] = useState('')
  /** 打开时的原值：保存时和它做 diff，只发改过的字段 */
  const [orig, setOrig] = useState<{ basics: Basics; content: RecipeContent } | null>(null)
  const [editorMode, setEditorMode] = useState<EditorMode>('fine')
  const [errors, setErrors] = useState<BasicErrors>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [photoErr, setPhotoErr] = useState<string | null>(null)
  /** 429：顶部提示条（文字修改照常可保存）；507：弹框 */
  const [quota, setQuota] = useState(false)
  const [full, setFull] = useState(false)
  // 这一页收到过 507：顶部红条立刻改“满啦”（刷新后按接口重判，不记住）
  const [got507, setGot507] = useState(false)
  // 后端逐条校验错误（v2.3.3 details）：在那一条旁边一直显示，改动那一栏前不消失
  const [issue, setIssue] = useState<EditorIssue | null>(null)
  const [storage] = useStorage(true)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  useTitle(confirmMode ? '修改后确认' : '编辑菜品')

  useEffect(() => {
    let alive = true
    api
      .getDish(id)
      .then((d) => {
        if (!alive) return
        const b = { name: d.name, category: d.category, note: d.note ?? '' }
        const src: RecipeContent = confirmMode && d.draft ? d.draft : d
        const c: RecipeContent = {
          ingredients: src.ingredients.map((x) => ({ ...x })),
          steps: src.steps.map((x) => ({ ...x })),
          tips: [...src.tips],
          servings: src.servings,
          total_time: src.total_time,
        }
        setDish(d)
        setBasics(b)
        setContent(c)
        setInitial(snap(b, c))
        setOrig({ basics: { ...b }, content: { ...c, ingredients: c.ingredients.map((x) => ({ ...x })), steps: c.steps.map((x) => ({ ...x })), tips: [...c.tips] } })
        setEditorMode(isEmptyContent(c) ? 'quick' : 'fine')
      })
      .catch((e) => alive && setLoadErr(e instanceof ApiError ? e.message : '这道菜没加载出来'))
    return () => {
      alive = false
    }
  }, [id, confirmMode])

  const dirty = !!content && !saved && snap(basics, content) !== initial
  const blocker = useUnsavedGuard(dirty && !saving)

  const photoItems = useMemo(() => (dish?.photos ?? []).map((p) => ({ key: p.id, url: p.url })), [dish])

  if (loadErr) {
    return (
      <main className="page page--narrow">
        <TopBar title="编辑菜品" />
        <StatePanel pose="think" title="这道菜打不开" text={loadErr} action={<Link className="btn btn--primary" to="/">回食堂首页</Link>} />
      </main>
    )
  }
  if (!dish || !content) {
    return (
      <main className="page page--narrow">
        <TopBar title="编辑菜品" />
        <PageLoading />
      </main>
    )
  }
  if (confirmMode && dish.chef_status !== CHEF_STATUS.draft) {
    return (
      <main className="page page--narrow">
        <TopBar title="修改后确认" back={`/dishes/${encodeURIComponent(dish.id)}`} />
        <StatePanel
          pose="think"
          title="这份草稿已经不在了"
          text="可能已经确认过，或者厨驼正在重写。"
          action={
            <Link className="btn btn--primary" to={`/dishes/${encodeURIComponent(dish.id)}`} replace>
              回到菜品
            </Link>
          }
        />
      </main>
    )
  }

  const detail = `/dishes/${encodeURIComponent(dish.id)}`

  // —— 照片：直接对接口操作 ——
  const addPhotos = async (files: File[]) => {
    const { ok, errors: errs } = checkFiles(files, dish.photos.length)
    setPhotoErr(errs.length ? errs.join('；') : null)
    if (!ok.length) return
    setPhotoBusy(true)
    const r = await compressAll(ok, (done, total) => setProgress({ done, total }))
    setProgress(null)
    const all = [...errs, ...r.errors]
    setPhotoErr(all.length ? all.join('；') : null)
    try {
      if (r.files.length) {
        setDish(await api.addPhotos(dish.id, r.files))
        app.toast(`加了 ${r.files.length} 张照片`, 'ok')
      }
    } catch (e) {
      const code = app.handleError(e, '照片没传上，再试一次')
      if (e instanceof ApiError && e.code === 'TOO_LARGE') {
        const n = photoIndexOf(e.message)
        const f = n ? r.files[n - 1] : r.files.find((x) => x.size > LIMITS.uploadMaxBytes)
        setPhotoErr(`${n ? `新加的第 ${n} 张：` : ''}${tooLargeText(f?.size)}，这次没加上，换一张吧`)
      }
      if (code === 'STORAGE_QUOTA') {
        setQuota(true)
        window.scrollTo({ top: 0, behavior: 'smooth' })
      }
      if (code === 'STORAGE_FULL') (setFull(true), setGot507(true))
    } finally {
      setPhotoBusy(false)
    }
  }
  const removePhoto = async (photoId: string) => {
    if (dish.photos.length <= 1) {
      setPhotoErr('至少要留 1 张照片')
      return
    }
    setPhotoBusy(true)
    try {
      setDish(await api.deletePhoto(dish.id, photoId))
      app.toast('照片已删除', 'ok')
    } catch (e) {
      app.handleError(e, '照片没删掉，再试一次')
    } finally {
      setPhotoBusy(false)
    }
  }
  const movePhoto = async (from: number, to: number) => {
    if (to < 0 || to >= dish.photos.length || from === to) return
    const prev = dish
    const next = dish.photos.slice()
    const [it] = next.splice(from, 1)
    next.splice(to, 0, it)
    setDish({ ...dish, photos: next, photo_url: next[0].url })
    setPhotoBusy(true)
    try {
      setDish(await api.reorderPhotos(dish.id, next.map((p) => p.id)))
    } catch (e) {
      setDish(prev)
      app.handleError(e, '顺序没保存上，再试一次')
    } finally {
      setPhotoBusy(false)
    }
  }

  const save = async () => {
    const e = confirmMode ? {} : validateBasics(basics)
    setErrors(e)
    if (Object.keys(e).length) {
      document.getElementById(e.name ? 'f-name' : e.category ? 'f-category' : 'f-note')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      app.toast('还有必填项没填好', 'err')
      return
    }
    // 没有打开时的原值就没法 diff：拦住，不能退回全量发送（全量会把厨驼菜谱改成手写并作废任务）
    if (!confirmMode && !orig) {
      app.toast('这道菜还没加载完，稍等一下再保存', 'err')
      return
    }
    const metaErr = metaErrors(content)
    if (metaErr.length) {
      app.toast(metaErr[0], 'err')
      return
    }
    setSaving(true)
    try {
      const c = cleanContent(content)
      if (confirmMode) {
        await api.confirmDraft(dish.id, c)
        app.toast(CONFIRMED_TEXT, 'ok')
      } else {
        // 只发真正改过的字段（后端审查 P1-1）：只改菜名/分类/备注时不带内容键，来源和厨驼任务都不变
        const patch = diffPatch(orig!, basics, content)
        if (Object.keys(patch).length) await api.updateDish(dish.id, patch)
        app.toast(Object.keys(patch).length ? '保存好啦' : '没有改动', 'ok')
      }
      setSaved(true)
      setTimeout(() => nav(detail, { replace: true }), 0)
    } catch (err) {
      // 后端 v2.3.3：JSON 请求体超过 64KB → 413 TOO_LARGE（保存不带照片，所以一定是内容太长）；表单原样保留
      if (err instanceof ApiError && err.code === 'TOO_LARGE') {
        app.toast(BODY_TOO_LARGE_TEXT, 'err')
        return
      }
      const fi = fieldIssueOf(err)
      const row = fi && content ? rawIndexOf(content, fi.field, fi.index) : -1
      if (fi && row >= 0) {
        setIssue({ field: fi.field, index: row, message: fi.message })
        return
      }
      const code = app.handleError(err, '没保存上，再试一次')
      if (code === 'BAD_STATE') setTimeout(() => nav(detail, { replace: true }), 600)
    } finally {
      setSaving(false)
    }
  }

  // 只有改了食材/步骤等内容才会作废厨驼任务（只改菜名/分类/备注不会）
  const contentChanged = !!orig && !!content && touchesContent(diffPatch(orig, basics, content))
  const chefTaskWillDrop = !confirmMode && contentChanged && (dish.chef_status === CHEF_STATUS.pending || dish.chef_status === CHEF_STATUS.draft)

  return (
    <main className="page page--form">
      <TopBar title={confirmMode ? '修改后确认' : '编辑菜品'} back={detail} />
      <form
        className="form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        {quota && <QuotaBanner onClose={() => setQuota(false)} />}
        {confirmMode ? (
          <div className="form-card form-card--chef">
            <ChefLlama pose="done" size={60} animated={false} />
            <p>
              改的是厨驼给 <b>「{dish.name}」</b> 写的草稿，点「确认保存」后成为正式菜谱。
            </p>
          </div>
        ) : (
          <>
            {chefTaskWillDrop && (
              <p className="notice notice--warn" role="note">
                <Icon name="chef" size={18} />
                {dish.chef_status === CHEF_STATUS.pending ? '厨驼正在写这道菜，' : '厨驼的草稿还没确认，'}
                自己保存后厨驼这次的任务就作废了。
              </p>
            )}
            <StorageWarn s={storage} got507={got507} />
            <section className="form-card" aria-labelledby="h-photos" id="f-photos">
              <h2 className="form-card-title" id="h-photos">
                照片
              </h2>
              <PhotoManager
                items={photoItems}
                onAdd={addPhotos}
                onRemove={removePhoto}
                onMove={movePhoto}
                busy={photoBusy}
                progress={progress}
                error={photoErr}
              />
            </section>
            <section className="form-card" aria-labelledby="h-basic">
              <h2 className="form-card-title" id="h-basic">
                基本信息
              </h2>
              <BasicFields value={basics} onChange={setBasics} errors={errors} notePlaceholder="比如：少放辣、加了土豆" />
            </section>
          </>
        )}
        <section className="form-card">
          <RecipeEditor
            value={content}
            onChange={setContent}
            mode={editorMode}
            onModeChange={setEditorMode}
            title="食材和步骤"
            issue={issue}
            onIssueClear={() => setIssue(null)}
          />
        </section>
        <div className="submit-bar submit-bar--split">
          <Link className="btn btn--ghost btn--lg" to={detail}>
            取消
          </Link>
          <button type="submit" className="btn btn--primary btn--lg" disabled={saving || photoBusy}>
            <Icon name="check" size={22} />
            {confirmMode ? '确认保存' : '保存'}
          </button>
        </div>
      </form>
      <BusyOverlay show={saving} text="正在保存…" />
      {confirmMode ? (
        <LeaveGuard blocker={blocker} title="修改还没保存，要离开吗？" body="这次的修改会丢掉；厨驼的草稿还在，回来可以接着改。" />
      ) : (
        <LeaveGuard blocker={blocker} />
      )}
      <FullDialog open={full} onClose={() => setFull(false)} />
    </main>
  )
}
