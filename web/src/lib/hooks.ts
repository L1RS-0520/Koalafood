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
