// P3 菜品详情：菜名 → 相册 → 分类/备注 → 食材 → 步骤漫画；按状态显示提示和操作（访客只看正式内容）
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, ApiError, CHEF_STATUS, isEmptyContent, LIMITS, POLL_MS, type Dish, type RecipeContent } from '../api'
import { ChefLlama, ChefWriting, Dots } from '../components/ChefLlama'
import { Gallery } from '../components/Gallery'
import { Icon } from '../components/Icon'
import { Koala } from '../components/Koala'
import { RecipeBody } from '../components/RecipeView'
import { Confirm, Dialog, PageLoading, Spinner, StatePanel, TopBar } from '../components/ui'
import { useApp } from '../lib/app'
import { categoryTone } from '../lib/category'
import { usePolling, useTitle } from '../lib/hooks'
import { cx, dateLabel, len } from '../lib/util'

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
        <RecipeBody content={official} name={dish.name} />
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
        <DraftReview dish={dish} />
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
          name={dish.name}
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
  const draftEmpty = isDraft && (!dish.draft || isEmptyContent(dish.draft))
  const sourceLine = showSource
    ? `${dish.source === 'manual' ? '菜谱由大王手写' : '菜谱由厨驼撰写 · 大王确认'} · ${dateLabel(dish.updated_at)}`
    : null

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
        {owner && isDraft && (
          <p className="state-bar state-bar--draft" role="status">
            <Icon name="alert" size={18} />
            <b>{draftEmpty ? '厨驼没写出来，等大王决定' : '厨驼交稿啦，等大王确认'}</b>
            <small>草稿只有你能看到</small>
          </p>
        )}
        {owner && isDraft && <ChefMessage dish={dish} />}
        {dish.note && (
          <p className="narration-box">
            <b>大王备注：</b>
            {dish.note}
          </p>
        )}
        {body}
        {sourceLine && <p className="detail-foot">{sourceLine}</p>}
      </article>

      {owner && (
        <div className={cx('action-bar', isDraft && 'action-bar--grid')}>
          {isDraft ? (
            <>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => run('confirm', () => api.confirmDraft(dish.id), '确认好啦，正式上菜！')}
                disabled={!!busy || draftEmpty}
                title={draftEmpty ? '空草稿不能直接确认' : undefined}
              >
                {busy === 'confirm' ? <Spinner /> : <Icon name="check" size={18} />}
                确认
              </button>
              <button type="button" className="btn btn--green" onClick={() => nav(`${editHref}?confirm=1`)} disabled={!!busy}>
                <Icon name="pencil" size={18} />
                {draftEmpty ? '我自己写' : '修改后确认'}
              </button>
              {app.chefEnabled ? (
                <button type="button" className="btn btn--ghost" onClick={() => (setRequest(''), setDlg('rewrite'))} disabled={!!busy}>
                  <Icon name="refresh" size={18} />
                  让厨驼重写
                </button>
              ) : (
                <button type="button" className="btn btn--ghost btn--danger-text" onClick={() => setDlg('delete')} disabled={!!busy}>
                  <Icon name="trash" size={18} />
                  删除这道菜
                </button>
              )}
              <button type="button" className="btn btn--ghost btn--danger-text" onClick={() => setDlg('discard')} disabled={!!busy}>
                <Icon name="trash" size={18} />
                不要了
              </button>
            </>
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
        title="这份草稿不要了？"
        body={hasOfficial ? '草稿会被扔掉，现在的正式菜谱保持不变。' : '草稿会被扔掉，这道菜会先显示“还没写步骤”，之后可以自己写或再找厨驼。'}
        okText="不要了"
        danger
        busy={busy === 'discard'}
        art={<ChefLlama pose="done" size={72} animated={false} />}
        onOk={() => run('discard', () => api.discardDraft(dish.id), '草稿已扔掉')}
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

/** 待写（没有正式内容）：厨驼写作中（看照片 → 想 → 写 循环） */
function ChefAtWork({ on, requested }: { on: boolean; requested: string | null }) {
  const [sub, setSub] = useState('正在看大王的照片…')
  return (
    <section className={cx('chef-work', !on && 'chef-work--off')} aria-live="polite">
      <div className="chef-work-art">{on ? <ChefWriting size={150} onSub={setSub} /> : <ChefLlama pose="off" size={130} />}</div>
      <div className="bubble bubble--up chef-work-bubble">
        {on ? (
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
            <h2>厨驼下班啦</h2>
            <p>「找厨驼写菜谱」已经关掉，这道菜可以自己写。</p>
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
      <ChefLlama pose={on ? 'write' : 'off'} size={54} animated={on} />
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

/** 厨驼留言卡（空草稿时红色警示样式） */
function ChefMessage({ dish }: { dish: Dish }) {
  const draft = dish.draft
  const empty = !draft || isEmptyContent(draft)
  const msg = draft?.chef_message ?? dish.chef_message
  if (!msg && !empty) return null
  return (
    <div className={cx('chef-msg', empty && 'chef-msg--alert')}>
      <span className="chef-msg-avatar">
        <ChefLlama pose={empty ? 'think' : 'done'} size={56} />
      </span>
      <div>
        <span className="chef-msg-label">{empty ? '厨驼留言 · 这次没写出来' : '厨驼留言'}</span>
        <p>{msg || '这道菜我没把握写好，大王换个说法再找我，或者自己写吧～'}</p>
      </div>
    </div>
  )
}

/** 草稿预览（绿色虚线框）；空草稿给出下一步提示 */
function DraftReview({ dish }: { dish: Dish }) {
  const draft = dish.draft
  const empty = !draft || isEmptyContent(draft)
  if (empty) {
    return <p className="draft-empty-text">这份草稿是空的：可以「让厨驼重写」并补充要求，或者点「我自己写」。</p>
  }
  return (
    <section className="draft-frame" aria-label="草稿预览">
      <span className="draft-frame-label">草稿预览</span>
      <RecipeBody content={draft!} name={dish.name} ending={false} />
    </section>
  )
}
