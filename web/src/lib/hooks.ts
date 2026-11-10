import { useEffect, useRef } from 'react'
import { useBlocker } from 'react-router-dom'

/** 页面可见时每 ms 执行一次；enabled=false 时停止 */
export function usePolling(fn: () => void, ms: number, enabled: boolean) {
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    if (!enabled) return
    let t: ReturnType<typeof setInterval> | undefined
    const start = () => {
      stop()
      t = setInterval(() => ref.current(), ms)
    }
    const stop = () => t && clearInterval(t)
    const onVis = () => {
      if (document.hidden) stop()
      else {
        ref.current()
        start()
      }
    }
    start()
    document.addEventListener('visibilitychange', onVis)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [ms, enabled])
}

/** 有未保存内容时：路由拦截 + 关页提示 */
export function useUnsavedGuard(dirty: boolean) {
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname)
  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])
  return blocker
}

/** 页面标题 */
export function useTitle(t: string) {
  useEffect(() => {
    document.title = t ? `${t} · 考拉食堂` : '考拉食堂'
  }, [t])
}

/** 聚焦输入框时滚进可视区，避开底部粘性操作栏，并跟随 visualViewport（手机键盘） */
export function useRevealFocusedField() {
  useEffect(() => {
    const field = (t: EventTarget | null) => {
      if (!(t instanceof HTMLElement)) return null
      if (t instanceof HTMLInputElement) {
        const typ = t.type
        if (typ === 'hidden' || typ === 'button' || typ === 'submit' || typ === 'checkbox' || typ === 'radio' || typ === 'file') return null
      }
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return t
      return null
    }
    const reveal = (el: HTMLElement) => {
      const vv = window.visualViewport
      const viewTop = vv ? vv.offsetTop : 0
      const viewBottom = vv ? vv.offsetTop + vv.height : window.innerHeight
      let safeBottom = viewBottom
      for (const bar of document.querySelectorAll<HTMLElement>('.submit-bar, .action-bar')) {
        const st = getComputedStyle(bar)
        if (st.position !== 'sticky' && st.position !== 'fixed') continue
        const r = bar.getBoundingClientRect()
        if (r.height > 0 && r.top < viewBottom && r.bottom > viewTop) safeBottom = Math.min(safeBottom, r.top)
      }
      const r = el.getBoundingClientRect()
      const pad = 8
      const visible = Math.min(r.height, 60)
      let dy = 0
      if (r.top < viewTop + pad) dy = r.top - viewTop - pad
      else if (r.top + visible > safeBottom - pad) dy = r.top + visible - (safeBottom - pad)
      if (Math.abs(dy) > 1) window.scrollBy({ top: dy, behavior: 'auto' })
    }
    const onFocus = (e: FocusEvent) => {
      const el = field(e.target)
      if (!el) return
      // 先让浏览器自己滚，再按粘性栏和 visualViewport 微调
      el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' })
      reveal(el)
      requestAnimationFrame(() => reveal(el))
    }
    const onViewport = () => {
      const el = field(document.activeElement)
      if (el) reveal(el)
    }
    document.addEventListener('focusin', onFocus)
    const vv = window.visualViewport
    vv?.addEventListener('resize', onViewport)
    vv?.addEventListener('scroll', onViewport)
    return () => {
      document.removeEventListener('focusin', onFocus)
      vv?.removeEventListener('resize', onViewport)
      vv?.removeEventListener('scroll', onViewport)
    }
  }, [])
}
