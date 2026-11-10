// P3 菜品详情：菜名 → 相册 → 分类/备注 → 食材 → 步骤漫画；按状态显示提示和操作（访客只看正式内容）
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, ApiError, CHEF_STATUS, isEmptyContent, LIMITS, POLL_MS, type Dish, type RecipeContent } from '../api'
import { ChefLlama } from '../components/ChefLlama'
import { Gallery } from '../components/Gallery'
import { Icon } from '../components/Icon'
import { Koala } from '../components/Koala'
import { RecipeBody } from '../components/RecipeView'
import { Confirm, Dialog, PageLoading, Spinner, StatePanel, TopBar } from '../components/ui'
import { useApp } from '../lib/app'
import { categoryTone } from '../lib/category'
import { usePolling, useTitle } from '../lib/hooks'
import { cx, len } from '../lib/util'

const VISITOR_WAIT = '考拉大王还在整理这道菜的菜谱～'

export function DishPage() {
  const { id = '' } = useParams()
  const app = useApp()
  const nav = useNavigate()
  const [dish, setDish] = useState<Dish | null>(null)
  const [err, setErr] = useState<ApiError | null>(null)
  const [dlg, setDlg] = useState<null | 'rewrite' | 'delete' | 'discard'>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [request, setRequest] = useState('')
  const prev = useRef<string | null>(null)
  useTitle(dish?.name ?? '菜品')

  const load = useCallback(
    async (silent = false) => {
      try {
        const d = await api.getDish(id)
        if (silent && prev.current === CHEF_STATUS.pending && d.chef_status === CHEF_STATUS.draft && app.canEdit) {
          app.toast('厨驼交稿啦！看看草稿吧', 'ok')
        }
        prev.current = d.chef_status
        setDish(d)
        setErr(null)
      } catch (e) {
        if (!silent) setErr(e instanceof ApiError ? e : new ApiError('INTERNAL', '这道菜没加载出来'))
      }
    },
    [id, app],
  )
  useEffect(() => {
    setDish(null)
    load()
  }, [load, app.canEdit])

  const pending = dish?.chef_status === CHEF_STATUS.pending
  usePolling(() => load(true), POLL_MS, !!pending && app.chefEnabled)

  /** 统一执行写操作：401/409 等处理 */
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
    }
  }

  if (err) {
    return (
      <main className="page page--narrow">
        <TopBar title="菜品" />
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
      </main>
    )
  }
  if (!dish) {
    return (
      <main className="page page--narrow">
        <TopBar title="菜品" />
        <PageLoading />
      </main>
    )
  }

  const official: RecipeContent = dish
  const hasOfficial = !isEmptyContent(official)
  const isDraft = dish.chef_status === CHEF_STATUS.draft
  const editHref = `/kitchen/dishes/${encodeURIComponent(dish.id)}/edit`
  const owner = app.canEdit

  // —— 中间主体：按角色和状态 ——
  let body: React.ReactNode
  if (!owner) {
    // 访客：只看正式内容；没有正式内容的待写/草稿菜给一句温柔的话
    body =
      !hasOfficial && dish.chef_status !== CHEF_STATUS.confirmed ? (
        <StatePanel pose="taste" title={VISITOR_WAIT} text="过一阵再来看看吧。" className="state-panel--inline" />
      ) : (
        <RecipeBody content={official} />
      )
  } else if (pending && !hasOfficial) {
    body = (
      <>
        <ChefAtWork on={app.chefEnabled} requested={dish.requested_note} />
        <div className="center-actions">
          <Link className={cx('btn', app.chefEnabled ? 'btn--ghost' : 'btn--primary')} to={editHref}>
            <Icon name="pencil" size={18} />
            我自己写
          </Link>
        </div>
      </>
    )
  } else if (isDraft) {
    body = (
      <>
        <DraftReview
          dish={dish}
          busy={busy}
          chefOn={app.chefEnabled}
          onConfirm={() => run('confirm', () => api.confirmDraft(dish.id), '确认好啦，正式上菜！')}
          onEditConfirm={() => nav(`${editHref}?confirm=1`)}
          onRewrite={() => (setRequest(''), setDlg('rewrite'))}
          onDiscard={() => setDlg('discard')}
          editHref={editHref}
        />
        {hasOfficial && (
          <details className="official-fold">
            <summary>
              <Icon name="down" size={18} />
              看看现在的正式版
            </summary>
            <RecipeBody content={official} />
          </details>
        )}
      </>
    )
  } else {
    body = (
      <>
        {pending && <RewritingBanner on={app.chefEnabled} requested={dish.requested_note} editHref={editHref} />}
        <RecipeBody
          content={official}
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
      </>
    )
  }

  const showSource = hasOfficial && (owner ? dish.chef_status === CHEF_STATUS.confirmed : true)

  return (
    <main className="page page--detail">
      <TopBar title={dish.category} />
      <article className="detail">
        <h1 className="detail-name">
          <span>{dish.name}</span>
        </h1>
        <Gallery photos={dish.photos} name={dish.name} />
        <div className="detail-meta">
          <span className={cx('tag', `tag--${categoryTone(dish.category)}`)}>{dish.category}</span>
          {dish.servings && hasOfficial && (
            <span className="meta-chip">
              <Icon name="users" size={16} />
              {dish.servings}
            </span>
          )}
          {dish.total_time && hasOfficial && (
            <span className="meta-chip meta-chip--num">
              <Icon name="clock" size={16} />
              {dish.total_time}
            </span>
          )}
          {showSource && <span className="meta-chip meta-chip--src">{dish.source === 'manual' ? '大王手写' : '厨驼执笔'}</span>}
        </div>
        {dish.note && (
          <div className="note-say">
            <Koala pose="taste" size={58} />
            <p className="bubble bubble--left">
              <b>大王备注</b>
              {dish.note}
            </p>
          </div>
        )}
        {body}
      </article>

      {owner && (
        <div className="action-bar">
          {isDraft ? (
            <button type="button" className="btn btn--ghost btn--danger-text" onClick={() => setDlg('delete')}>
              <Icon name="trash" size={18} />
              删除
            </button>
          ) : (
            <>
              <Link className="btn btn--ghost" to={editHref}>
                <Icon name="edit" size={18} />
                {pending && !hasOfficial ? '我自己写' : '编辑'}
              </Link>
              {app.chefEnabled && !pending && (
                <button type="button" className="btn btn--secondary" onClick={() => (setRequest(''), setDlg('rewrite'))}>
                  <Icon name="chef" size={18} />
                  让厨驼重写
                </button>
              )}
              <button type="button" className="btn btn--ghost btn--danger-text" onClick={() => setDlg('delete')} aria-label="删除这道菜">
                <Icon name="trash" size={18} />
                删除
              </button>
            </>
          )}
        </div>
      )}

      <Dialog
        open={dlg === 'rewrite'}
        onClose={() => !busy && setDlg(null)}
        title={isDraft ? '让厨驼重写？' : hasOfficial ? '让厨驼重写这道菜？' : '交给厨驼写？'}
        art={<ChefLlama pose="write" size={78} />}
        actions={
          <>
            <button type="button" className="btn btn--ghost" onClick={() => setDlg(null)} disabled={!!busy}>
              先不了
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={!!busy || len(request) > LIMITS.noteMax}
              onClick={() => run('rewrite', () => api.askChef(dish.id, request.trim() || undefined), '交给厨驼啦，写好会自动出现')}
            >
              {busy === 'rewrite' && <Spinner />}
              {isDraft ? '扔掉草稿，重写' : '交给厨驼'}
            </button>
          </>
        }
      >
        {isDraft ? (
          <p className="warn-line">
            <b>现在的草稿会被扔掉</b>，厨驼会重新写一份。
          </p>
        ) : hasOfficial ? (
          <p>新草稿写好、你确认之前，现在的菜谱照常显示，不会丢。</p>
        ) : null}
        <label className="field">
          <span className="field-label">
            想让厨驼怎么改？ <em>可不填</em>
          </span>
          <textarea className="textarea" rows={3} value={request} placeholder="比如：改成空气炸锅做法、少放油" onChange={(e) => setRequest(e.target.value)} />
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
        title="这份草稿不要了？"
        body={hasOfficial ? '草稿会被扔掉，现在的正式菜谱保持不变。' : '草稿会被扔掉，这道菜会先显示“还没写步骤”，之后可以自己写或再找厨驼。'}
        okText="不要了"
        danger
        busy={busy === 'discard'}
        art={<ChefLlama pose="idle" size={72} animated={false} />}
        onOk={() => run('discard', () => api.discardDraft(dish.id), '草稿已扔掉')}
        onCancel={() => setDlg(null)}
      />

      <Confirm
        open={dlg === 'delete'}
        title={`确定删除「${dish.name}」？`}
        body={`这道菜和它的 ${dish.photos.length} 张照片都会被删掉，删了就找不回来了。`}
        okText="删除"
        cancelText="留着"
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

/** 待写（没有正式内容）：厨驼写作中 */
function ChefAtWork({ on, requested }: { on: boolean; requested: string | null }) {
  return (
    <section className={cx('chef-work', !on && 'chef-work--off')} aria-live="polite">
      <div className="chef-work-art">
        <ChefLlama pose={on ? 'write' : 'sleep'} size={132} animated={on} />
      </div>
      <div className="bubble bubble--up chef-work-bubble">
        {on ? (
          <>
            <h2>厨驼正在写菜谱…</h2>
            <p>一般几分钟就好，写好会自动出现在这里，不用刷新。</p>
            {requested && (
              <p className="chef-req">
                <b>你的要求：</b>
                {requested}
              </p>
            )}
          </>
        ) : (
          <>
            <h2>厨驼下班啦</h2>
            <p>「找厨驼写菜谱」已经关掉，这道菜可以改成自己写。</p>
          </>
        )}
      </div>
    </section>
  )
}

/** 重写中：旧内容照常显示，顶部叠一条提示 */
function RewritingBanner({ on, requested, editHref }: { on: boolean; requested: string | null; editHref: string }) {
  return (
    <div className={cx('rewrite-banner', !on && 'rewrite-banner--off')} role="status">
      <ChefLlama pose={on ? 'wok' : 'sleep'} size={54} animated={on} />
      <div>
        <b>{on ? '厨驼正在重写…' : '重写暂停了（厨驼已下班）'}</b>
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

/** 草稿待确认 */
function DraftReview({
  dish,
  busy,
  chefOn,
  onConfirm,
  onEditConfirm,
  onRewrite,
  onDiscard,
  editHref,
}: {
  dish: Dish
  busy: string | null
  chefOn: boolean
  onConfirm: () => void
  onEditConfirm: () => void
  onRewrite: () => void
  onDiscard: () => void
  editHref: string
}) {
  const draft = dish.draft
  const empty = !draft || isEmptyContent(draft)
  const msg = draft?.chef_message ?? dish.chef_message
  return (
    <section className={cx('draft', empty && 'draft--empty')} aria-label="厨驼的草稿">
      <div className="draft-head">
        <span className="draft-stamp">草稿待确认</span>
      </div>
      {msg && (
        <div className={cx('chef-say', empty && 'chef-say--alert')}>
          <ChefLlama pose="idle" size={64} animated={false} />
          <p className="bubble bubble--left">
            <b>厨驼说</b>
            {msg}
          </p>
        </div>
      )}
      {empty ? (
        <>
          {!msg && <p className="draft-empty-text">厨驼这次交了白卷，换个说法再找他，或者自己写吧。</p>}
          <div className="draft-actions draft-actions--empty">
            {chefOn && (
              <button type="button" className="btn btn--primary btn--lg" onClick={onRewrite} disabled={!!busy}>
                <Icon name="chef" size={20} />
                让厨驼重写
              </button>
            )}
            <Link className={cx('btn btn--lg', chefOn ? 'btn--secondary' : 'btn--primary')} to={editHref}>
              <Icon name="pencil" size={20} />
              我自己写
            </Link>
            <button type="button" className="btn btn--text" onClick={onDiscard} disabled={!!busy}>
              不要这份草稿
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="draft-body">
            <RecipeBody content={draft!} />
          </div>
          <div className="draft-actions">
            <button type="button" className="btn btn--primary btn--lg btn--block" onClick={onConfirm} disabled={!!busy}>
              {busy === 'confirm' ? <Spinner /> : <Icon name="check" size={20} />}
              确认
            </button>
            <div className="draft-actions-row">
              <button type="button" className="btn btn--secondary" onClick={onEditConfirm} disabled={!!busy}>
                <Icon name="edit" size={18} />
                修改后确认
              </button>
              {chefOn && (
                <button type="button" className="btn btn--ghost" onClick={onRewrite} disabled={!!busy}>
                  <Icon name="refresh" size={18} />
                  让厨驼重写
                </button>
              )}
            </div>
            <button type="button" className="btn btn--text" onClick={onDiscard} disabled={!!busy}>
              不要了
            </button>
          </div>
        </>
      )}
    </section>
  )
}
