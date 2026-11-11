// 菜品详情（规范 §5.3）：菜名 → 元信息 → 主图 + 页码 → 四格步骤 →「更多」。草稿在正文末尾放「确认」主按钮；其余大王操作收在顶栏「···」。
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, ApiError, CHEF_STATUS, CONFIRMED_TEXT, isEmptyContent, LIMITS, POLL_MS, type Dish, type RecipeContent } from '../api'
import { AccountActions } from '../components/AccountActions'
import { ChefLlama, ChefWriting, Dots } from '../components/ChefLlama'
import { Gallery } from '../components/Gallery'
import { Icon } from '../components/Icon'
import { Koala } from '../components/Koala'
import { RecipeBody } from '../components/RecipeView'
import { BackButton, SiteHeader } from '../components/SiteHeader'
import { Confirm, Dialog, PageLoading, Spinner, StatePanel } from '../components/ui'
import { useApp } from '../lib/app'
import { usePolling, useTitle } from '../lib/hooks'
import { cx, dateLabel, len } from '../lib/util'

const VISITOR_WAIT = '考拉大王还在整理这道菜的菜谱～'
const HANDOFF_MS = 800

export function DishPage() {
  const { id = '' } = useParams()
  const app = useApp()
  const nav = useNavigate()
  const [dish, setDish] = useState<Dish | null>(null)
  const [err, setErr] = useState<ApiError | null>(null)
  const [dlg, setDlg] = useState<null | 'rewrite' | 'delete' | 'discard'>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [request, setRequest] = useState('')
  const [menu, setMenu] = useState(false)
  const menuBox = useRef<HTMLDivElement>(null)
  const prev = useRef<string | null>(null)
  const [handoff, setHandoff] = useState(false)
  useTitle(dish?.name ?? '菜品')

  const { canEdit, toast } = app
  const load = useCallback(
    async (silent = false) => {
      try {
        const d = await api.getDish(id)
        if (silent && prev.current === CHEF_STATUS.pending && d.chef_status === CHEF_STATUS.draft && canEdit) {
          prev.current = d.chef_status
          setHandoff(true)
          await new Promise((r) => setTimeout(r, HANDOFF_MS))
          setHandoff(false)
          toast('厨驼交稿啦！看看草稿吧', 'ok')
        }
        prev.current = d.chef_status
        setDish(d)
        setErr(null)
      } catch (e) {
        if (!silent) setErr(e instanceof ApiError ? e : new ApiError('INTERNAL', '这道菜没加载出来'))
      }
    },
    [id, canEdit, toast],
  )
  useEffect(() => {
    setDish(null)
    load()
  }, [load])

  useEffect(() => {
    if (!menu) return
    const onDoc = (e: MouseEvent) => {
      if (!menuBox.current?.contains(e.target as Node)) setMenu(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [menu])

  const pending = dish?.chef_status === CHEF_STATUS.pending
  usePolling(() => load(true), POLL_MS, !!pending && app.chefEnabled)

  const run = async (key: string, fn: () => Promise<Dish | void>, ok?: string) => {
    setBusy(key)
    try {
      const d = await fn()
      if (d) {
        prev.current = d.chef_status
        setDish(d)
      }
      if (ok) app.toast(ok, 'ok')
      return true
    } catch (e) {
      const code = app.handleError(e)
      if (code === 'BAD_STATE' || code === 'CONFLICT' || code === 'NOT_FOUND') load(true)
      return false
    } finally {
      setBusy(null)
      setDlg(null)
      setMenu(false)
    }
  }

  const header = (right?: ReactNode) => (
    <SiteHeader align="center" left={<BackButton />} right={right} />
  )

  if (err) {
    return (
      <main className="page page--detail">
        {header()}
        <div className="detail">
          <StatePanel
            pose="think"
            title={err.status === 404 ? '这道菜找不到了' : '菜没端上来'}
            text={err.message}
            action={
              err.status === 404 ? (
                <Link className="btn btn--primary" to="/">
                  回食堂首页
                </Link>
              ) : (
                <button type="button" className="btn btn--primary" onClick={() => load()}>
                  <Icon name="refresh" size={18} />
                  再试一次
                </button>
              )
            }
          />
        </div>
      </main>
    )
  }
  if (!dish) {
    return (
      <main className="page page--detail">
        {header()}
        <div className="detail">
          <PageLoading />
        </div>
      </main>
    )
  }

  const official: RecipeContent = dish
  const hasOfficial = !isEmptyContent(official)
  const isDraft = dish.chef_status === CHEF_STATUS.draft
  const editHref = `/kitchen/dishes/${encodeURIComponent(dish.id)}/edit`
  const owner = app.canEdit
  const draftEmpty = isDraft && (!dish.draft || isEmptyContent(dish.draft))
  const shown: RecipeContent = isDraft && dish.draft && !isEmptyContent(dish.draft) ? dish.draft : official
  const showSource = hasOfficial && (owner ? dish.chef_status === CHEF_STATUS.confirmed : true)
  const sourceLine = showSource
    ? `${dish.source === 'manual' ? '菜谱由大王手写' : '菜谱由厨驼撰写 · 大王确认'} · ${dateLabel(dish.updated_at)}`
    : null

  const servings = shown.servings || (hasOfficial ? dish.servings : null)
  const totalTime = shown.total_time || (hasOfficial ? dish.total_time : null)
  const metaParts = [dish.category, servings, totalTime].filter(Boolean)

  let notices: React.ReactNode = null
  let body: React.ReactNode
  let after: React.ReactNode = null
  if (!owner) {
    body =
      !hasOfficial && dish.chef_status !== CHEF_STATUS.confirmed ? (
        <StatePanel pose="taste" title={VISITOR_WAIT} text="过一阵再来看看吧。" className="state-panel--inline" />
      ) : (
        <RecipeBody content={official} note={dish.note} source={sourceLine} />
      )
  } else if (pending && !hasOfficial) {
    body = <ChefAtWork on={app.chefEnabled} requested={dish.requested_note} handoff={handoff} />
  } else if (isDraft) {
    notices = (
      <>
        <p className="state-bar state-bar--draft" role="status">
          {draftEmpty ? '厨驼没写出来，等大王决定。草稿只有你能看到。' : '厨驼交稿啦，等大王确认。草稿只有你能看到。'}
        </p>
        <ChefMessage dish={dish} />
      </>
    )
    body = draftEmpty ? (
      <p className="draft-empty-text">
        {app.chefEnabled
          ? '这份草稿是空的：可以在「···」里让厨驼重写并补充要求，或者自己写。'
          : '这份草稿是空的：可以在「···」里自己写，或者不要这份草稿。'}
      </p>
    ) : (
      <RecipeBody content={dish.draft!} note={dish.note} />
    )
    after = hasOfficial ? (
      <details className="official-fold">
        <summary>看看现在的正式版</summary>
        <RecipeBody content={official} note={dish.note} source={sourceLine} />
      </details>
    ) : null
  } else {
    notices = pending ? <RewritingBanner on={app.chefEnabled} requested={dish.requested_note} editHref={editHref} /> : null
    body = (
      <RecipeBody
        content={official}
        note={dish.note}
        source={sourceLine}
        emptyHint="想起来怎么做的时候，随手记几行就好～"
        emptyAction={
          <>
            <Link className="btn btn--primary" to={editHref}>
              <Icon name="pencil" size={18} />
              我来写
            </Link>
            {app.chefEnabled && (
              <button type="button" className="btn btn--ghost" onClick={() => (setRequest(''), setDlg('rewrite'))}>
                <Icon name="chef" size={18} />
                找厨驼写
              </button>
            )}
          </>
        }
      />
    )
  }

  const menuItems: ReactNode[] = []
  if (owner) {
    if (isDraft) {
      menuItems.push(
        <Link key="edit" role="menuitem" className="overflow-item" to={`${editHref}?confirm=1`} onClick={() => setMenu(false)}>
          {draftEmpty ? '我自己写' : '修改后确认'}
        </Link>,
      )
      if (app.chefEnabled) {
        menuItems.push(
          <button
            key="rewrite"
            type="button"
            role="menuitem"
            className="overflow-item"
            disabled={!!busy}
            onClick={() => (setRequest(''), setDlg('rewrite'), setMenu(false))}
          >
            让厨驼重写
          </button>,
        )
      }
      menuItems.push(
        <button
          key="discard"
          type="button"
          role="menuitem"
          className="overflow-item overflow-item--danger"
          disabled={!!busy}
          onClick={() => (setDlg('discard'), setMenu(false))}
        >
          不要了
        </button>,
      )
    } else {
      if (!(pending && !hasOfficial)) {
        menuItems.push(
          <Link key="edit" role="menuitem" className="overflow-item" to={editHref} onClick={() => setMenu(false)}>
            编辑
          </Link>,
        )
      } else {
        menuItems.push(
          <Link key="write" role="menuitem" className="overflow-item" to={editHref} onClick={() => setMenu(false)}>
            {app.chefEnabled ? '等不及了，我自己写' : '我自己写'}
          </Link>,
        )
      }
      if (app.chefEnabled && !pending) {
        menuItems.push(
          <button
            key="rewrite"
            type="button"
            role="menuitem"
            className="overflow-item"
            onClick={() => (setRequest(''), setDlg('rewrite'), setMenu(false))}
          >
            让厨驼重写
          </button>,
        )
      }
      menuItems.push(
        <button
          key="delete"
          type="button"
          role="menuitem"
          className="overflow-item overflow-item--danger"
          onClick={() => (setDlg('delete'), setMenu(false))}
        >
          删除
        </button>,
      )
    }
  }

  const right = owner ? (
    <div className="overflow" ref={menuBox}>
      <button type="button" className="hit" aria-label="更多操作" aria-expanded={menu} aria-haspopup="menu" onClick={() => setMenu((v) => !v)}>
        <Icon name="more" />
      </button>
      {menu && (
        <div className="overflow-menu" role="menu">
          {menuItems}
        </div>
      )}
    </div>
  ) : (
    <AccountActions />
  )

  return (
    <main className="page page--detail">
      {header(right)}
      <article className={cx('detail', owner && draftEmpty && 'detail--draft-empty')}>
        <h1 className="detail-title">{dish.name}</h1>
        {metaParts.length > 0 && <p className="detail-meta-line">{metaParts.join(' · ')}</p>}
        {notices}
        <div className="detail-stage">
          <Gallery photos={dish.photos} name={dish.name} />
          <div className="detail-steps">{body}</div>
        </div>
        {after}
        {owner && isDraft && (
          <div className="draft-confirm">
            <button
              type="button"
              className="btn btn--primary"
              disabled={!!busy || draftEmpty}
              title={draftEmpty ? '空草稿不能直接确认' : undefined}
              onClick={() => run('confirm', () => api.confirmDraft(dish.id), CONFIRMED_TEXT)}
            >
              {busy === 'confirm' ? <Spinner /> : null}
              确认
            </button>
          </div>
        )}
      </article>

      <Dialog
        open={dlg === 'rewrite'}
        onClose={() => !busy && setDlg(null)}
        title={hasOfficial || isDraft ? '让厨驼重写？' : '交给厨驼写？'}
        art={<ChefLlama pose="write" size={78} />}
        actions={
          <>
            <button type="button" className="btn btn--ghost" onClick={() => setDlg(null)} disabled={!!busy}>
              取消
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={!!busy || len(request) > LIMITS.noteMax}
              onClick={() => run('rewrite', () => api.askChef(dish.id, request.trim() || undefined), '交给厨驼啦，写好会自动出现')}
            >
              {busy === 'rewrite' ? <Spinner /> : <Icon name="refresh" size={18} />}
              {hasOfficial || isDraft ? '让厨驼重写' : '交给厨驼'}
            </button>
          </>
        }
      >
        {isDraft ? (
          <p className="warn-line">
            <b>现在的草稿会被扔掉</b>，厨驼会重新写一份。已确认的正式内容不受影响。
          </p>
        ) : hasOfficial ? (
          <p>新草稿写好、你确认之前，现在的菜谱照常显示，不会丢。</p>
        ) : null}
        <label className="field">
          <span className="field-label">
            给厨驼的要求 <em>选填</em>
          </span>
          <textarea className="textarea" rows={3} value={request} placeholder="比如：这次加了土豆，少放油" onChange={(e) => setRequest(e.target.value)} />
          <span className="field-foot">
            <span />
            <span className={cx('counter', len(request) > LIMITS.noteMax && 'over')}>
              {len(request)}/{LIMITS.noteMax}
            </span>
          </span>
        </label>
      </Dialog>

      <Confirm
        open={dlg === 'discard'}
        title="不要这份草稿了？"
        body={
          hasOfficial
            ? '草稿会被丢掉，原来的正式内容不变。'
            : app.chefEnabled
              ? '草稿会被丢掉，这道菜会先显示“还没写步骤”，之后可以自己写或再找厨驼。'
              : '草稿会被丢掉，这道菜会先显示“还没写步骤”，之后可以自己写。'
        }
        okText="不要了"
        cancelText="再想想"
        danger
        busy={busy === 'discard'}
        art={<ChefLlama pose="done" size={72} animated={false} />}
        onOk={() => run('discard', () => api.discardDraft(dish.id), '草稿已丢掉')}
        onCancel={() => setDlg(null)}
      />

      <Confirm
        open={dlg === 'delete'}
        title={`删掉「${dish.name}」？`}
        body={`菜谱和 ${dish.photos.length} 张照片会一起删除，删了就找不回来啦。`}
        okText="删除"
        cancelText="再想想"
        danger
        busy={busy === 'delete'}
        art={<Koala pose="think" size={80} />}
        onOk={async () => {
          const ok = await run('delete', () => api.deleteDish(dish.id), '已删除')
          if (ok) nav('/', { replace: true })
        }}
        onCancel={() => setDlg(null)}
      />
    </main>
  )
}

function ChefAtWork({ on, requested, handoff }: { on: boolean; requested: string | null; handoff?: boolean }) {
  const [sub, setSub] = useState('正在看大王的照片…')
  return (
    <section className={cx('chef-work', !on && 'chef-work--off')} aria-live="polite">
      <div className="chef-work-art">
        {!on ? (
          <ChefLlama pose="off" size={112} />
        ) : handoff ? (
          <ChefLlama pose="done" size={116} className="llama--handoff" title="厨驼交稿啦" />
        ) : (
          <ChefWriting size={116} onSub={setSub} />
        )}
      </div>
      <div className="chef-work-copy">
        {on && handoff ? (
          <>
            <h2>交稿啦！</h2>
            <p className="chef-work-sub">厨驼写好了，马上给大王看～</p>
          </>
        ) : on ? (
          <>
            <h2>
              厨驼正在写菜谱
              <Dots />
            </h2>
            <p className="chef-work-sub">{sub}</p>
            <p>写好会自动出现在这里，不用刷新。</p>
            {requested && (
              <p className="chef-req">
                <b>你的要求：</b>
                {requested}
              </p>
            )}
          </>
        ) : (
          <>
            <h2>厨驼已经休息啦</h2>
            <p>这道菜还没写，可以改为自己写。</p>
          </>
        )}
      </div>
    </section>
  )
}

function RewritingBanner({ on, requested, editHref }: { on: boolean; requested: string | null; editHref: string }) {
  return (
    <div className={cx('rewrite-banner', !on && 'rewrite-banner--off')} role="status">
      <div>
        <b>{on ? '厨驼正在重写…' : '重写暂停了（厨驼已经休息啦）'}</b>
        <span>
          {on ? '下面是现在的版本，新草稿写好后等你确认。' : '下面是现在的版本，也可以直接自己改。'}
          {requested && on && ` 要求：${requested}`}
        </span>
      </div>
      {!on && (
        <Link className="btn btn--ghost btn--sm" to={editHref}>
          自己改
        </Link>
      )}
    </div>
  )
}

function ChefMessage({ dish }: { dish: Dish }) {
  const draft = dish.draft
  const empty = !draft || isEmptyContent(draft)
  const msg = draft?.chef_message ?? dish.chef_message
  if (!msg && !empty) return null
  return (
    <div className={cx('chef-msg', empty && 'chef-msg--alert')}>
      <div>
        <span className="chef-msg-label">{empty ? '厨驼留言 · 这次没写出来' : '厨驼留言'}</span>
        <p>{msg || '这道菜我没把握写好，大王换个说法再找我，或者自己写吧～'}</p>
      </div>
    </div>
  )
}
