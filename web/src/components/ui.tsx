// 基础 UI：顶栏、弹窗、提示条、状态面板、加载
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate } from 'react-router-dom'
import { useApp } from '../lib/app'
import { cx } from '../lib/util'
import { Icon } from './Icon'
import { Koala, type KoalaPose } from './Koala'

export function TopBar({ title, back = '/', right }: { title: ReactNode; back?: string | false; right?: ReactNode }) {
  const nav = useNavigate()
  return (
    <header className="topbar">
      {back !== false ? (
        <button
          type="button"
          className="icon-btn"
          aria-label="返回"
          onClick={() => (window.history.length > 1 && window.history.state?.idx > 0 ? nav(-1) : nav(back))}
        >
          <Icon name="back" />
        </button>
      ) : (
        <span className="topbar-spacer" />
      )}
      <h1 className="topbar-title">{title}</h1>
      <div className="topbar-right">{right ?? <span className="topbar-spacer" />}</div>
    </header>
  )
}

export function Dialog({
  open,
  onClose,
  title,
  children,
  actions,
  tone = 'normal',
  art,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  children?: ReactNode
  actions: ReactNode
  tone?: 'normal' | 'danger'
  art?: ReactNode
}) {
  const id = useId()
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    const t = setTimeout(() => box.current?.querySelector<HTMLElement>('[data-autofocus], textarea, button')?.focus(), 30)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'Tab' && box.current) {
        const f = box.current.querySelectorAll<HTMLElement>('button, textarea, input, a[href]')
        if (!f.length) return
        const first = f[0]
        const last = f[f.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    document.body.classList.add('no-scroll')
    return () => {
      clearTimeout(t)
      document.removeEventListener('keydown', onKey)
      document.body.classList.remove('no-scroll')
      prev?.focus?.()
    }
  }, [open, onClose])
  if (!open) return null
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={box} className={cx('modal', tone === 'danger' && 'modal--danger')} role="dialog" aria-modal="true" aria-labelledby={id}>
        {art && <div className="modal-art">{art}</div>}
        <h2 id={id} className="modal-title">
          {title}
        </h2>
        {children && <div className="modal-body">{children}</div>}
        <div className="modal-actions">{actions}</div>
      </div>
    </div>,
    document.body,
  )
}

/** 简单确认弹窗 */
export function Confirm({
  open,
  title,
  body,
  okText = '确定',
  cancelText = '再想想',
  danger,
  busy,
  onOk,
  onCancel,
  art,
}: {
  open: boolean
  title: ReactNode
  body?: ReactNode
  okText?: string
  cancelText?: string
  danger?: boolean
  busy?: boolean
  onOk: () => void
  onCancel: () => void
  art?: ReactNode
}) {
  return (
    <Dialog
      open={open}
      onClose={() => !busy && onCancel()}
      title={title}
      tone={danger ? 'danger' : 'normal'}
      art={art}
      actions={
        <>
          <button type="button" className="btn btn--ghost" onClick={onCancel} disabled={busy} data-autofocus>
            {cancelText}
          </button>
          <button type="button" className={cx('btn', danger ? 'btn--danger' : 'btn--primary')} onClick={onOk} disabled={busy}>
            {busy ? <Spinner /> : null}
            {okText}
          </button>
        </>
      }
    >
      {body}
    </Dialog>
  )
}

/** 离开前未保存提示（配合 useUnsavedGuard） */
/** 离开未保存（设计/2026-11-10-确认对话框 ①②）：左「继续编辑」，右红「不保存，离开」 */
export function LeaveGuard({
  blocker,
  title = '还没保存，要离开吗？',
  body = '刚才改的内容还没保存，离开就没了哦。',
  okText = '不保存，离开',
  cancelText = '继续编辑',
}: {
  blocker: { state: string; proceed?: () => void; reset?: () => void }
  title?: string
  body?: string
  okText?: string
  cancelText?: string
}) {
  return (
    <Confirm
      open={blocker.state === 'blocked'}
      title={title}
      body={body}
      okText={okText}
      cancelText={cancelText}
      danger
      art={<Koala pose="think" size={70} />}
      onOk={() => blocker.proceed?.()}
      onCancel={() => blocker.reset?.()}
    />
  )
}

export function Toasts() {
  const { toasts } = useApp()
  return createPortal(
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={cx('toast', `toast--${t.kind}`)}>
          <span className="toast-dot" aria-hidden="true">
            {t.kind === 'ok' ? <Icon name="check" size={16} /> : t.kind === 'err' ? '!' : <Icon name="star" size={16} />}
          </span>
          {t.text}
        </div>
      ))}
    </div>,
    document.body,
  )
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cx('spinner', className)} aria-hidden="true" />
}

/** 空/错/提示面板（考拉插图 + 气泡） */
export function StatePanel({
  pose = 'think',
  title,
  text,
  action,
  art,
  className,
}: {
  pose?: KoalaPose
  title: ReactNode
  text?: ReactNode
  action?: ReactNode
  art?: ReactNode
  className?: string
}) {
  return (
    <section className={cx('state-panel', className)}>
      <div className="state-art">{art ?? <Koala pose={pose} size={120} />}</div>
      <div className="bubble bubble--up">
        <h2 className="state-title">{title}</h2>
        {text && <p className="state-text">{text}</p>}
      </div>
      {action && <div className="state-action">{action}</div>}
    </section>
  )
}

/** 整页加载：考拉拿勺子蹦 */
export function PageLoading({ text = '考拉正在端菜…' }: { text?: string }) {
  return (
    <div className="page-loading" role="status">
      <Koala pose="spoon" size={96} className="bounce" />
      <p>{text}</p>
    </div>
  )
}

/** 提交时的全屏遮罩 */
export function BusyOverlay({ show, text }: { show: boolean; text: string }) {
  const [vis, setVis] = useState(show)
  useEffect(() => {
    if (show) setVis(true)
    else {
      const t = setTimeout(() => setVis(false), 180)
      return () => clearTimeout(t)
    }
  }, [show])
  if (!vis) return null
  return createPortal(
    <div className={cx('busy', !show && 'busy--out')} role="status" aria-live="assertive">
      <div className="busy-card">
        <Koala pose="spoon" size={110} className="bounce" />
        <p className="busy-text">{text}</p>
        <div className="busy-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
      </div>
    </div>,
    document.body,
  )
}

export function NotFound() {
  return (
    <main className="page page--narrow">
      <TopBar title="走丢了" />
      <StatePanel
        pose="think"
        title="这一页找不到啦"
        text="可能链接写错了，或者这道菜已经被撤下。"
        action={
          <Link className="btn btn--primary" to="/">
            回食堂首页
          </Link>
        }
      />
    </main>
  )
}
