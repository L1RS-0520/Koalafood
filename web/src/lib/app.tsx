// 全局状态：登录（can_edit）、设置（chef_enabled）、提示条
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, ApiError, IS_MOCK, KITCHEN_LOGIN_ROUTE } from '../api'

export const STORAGE_QUOTA_TEXT = '今天食堂的照片柜塞满啦，明天再来传吧～'

type ToastKind = 'ok' | 'err' | 'info'
interface Toast {
  id: number
  kind: ToastKind
  text: string
}

interface AppState {
  ready: boolean
  canEdit: boolean
  email: string | null
  chefEnabled: boolean
  isMock: boolean
  login(next?: string): Promise<void>
  logout(): Promise<void>
  refreshMe(): Promise<void>
  setChefEnabled(v: boolean): Promise<void>
  refreshSettings(): Promise<void>
  toast(text: string, kind?: ToastKind): void
  /** 统一处理接口错误：401 → 切访客；其余弹提示。返回 code 方便调用方追加处理 */
  handleError(e: unknown, fallback?: string): string
  toasts: Toast[]
}

const Ctx = createContext<AppState | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [canEdit, setCanEdit] = useState(false)
  const [email, setEmail] = useState<string | null>(null)
  const [chefEnabled, setChef] = useState(true)
  const [toasts, setToasts] = useState<Toast[]>([])
  const seq = useRef(0)

  const toast = useCallback((text: string, kind: ToastKind = 'info') => {
    const id = ++seq.current
    setToasts((t) => [...t.slice(-2), { id, kind, text }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'err' ? 4200 : 2800)
  }, [])

  const refreshMe = useCallback(async () => {
    try {
      const me = await api.me()
      setCanEdit(me.can_edit)
      setEmail(me.email)
    } catch {
      setCanEdit(false)
    }
  }, [])

  const refreshSettings = useCallback(async () => {
    try {
      const s = await api.getSettings()
      setChef(s.chef_enabled)
    } catch {
      /* 读不到设置时保持默认（开） */
    }
  }, [])

  useEffect(() => {
    Promise.all([refreshMe(), refreshSettings()]).finally(() => setReady(true))
  }, [refreshMe, refreshSettings])

  const handleError = useCallback(
    (e: unknown, fallback = '出了点小状况，再试一次吧') => {
      if (e instanceof ApiError) {
        if (e.status === 401 || e.code === 'UNAUTHORIZED') {
          setCanEdit(false)
          toast('登录过期了，大王请重新登录', 'err')
        } else if (e.code === 'STORAGE_QUOTA' || e.status === 429) {
          // 按码映射产品文案，不显示后端 message
          toast(STORAGE_QUOTA_TEXT, 'err')
        } else if (e.code === 'CHEF_DISABLED') {
          setChef(false)
          toast(e.message, 'err')
        } else {
          toast(e.message || fallback, 'err')
        }
        return e.code
      }
      toast(fallback, 'err')
      return 'UNKNOWN'
    },
    [toast],
  )

  const login = useCallback(
    async (next?: string) => {
      const target = next ?? window.location.pathname + window.location.search
      try {
        const ok = await api.devLogin()
        if (ok) {
          await refreshMe()
          toast('欢迎回来，大王！', 'ok')
          return
        }
      } catch {
        /* 落到线上登录 */
      }
      // 线上：整页跳到 Access 保护的后厨路由，登录后回到 next
      if (!window.location.pathname.startsWith(KITCHEN_LOGIN_ROUTE)) {
        window.location.assign(`${KITCHEN_LOGIN_ROUTE}?next=${encodeURIComponent(target)}`)
      } else {
        toast('登录没成功：本地后端需要在 .dev.vars 里开启 DEV_AUTH=1', 'err')
      }
    },
    [refreshMe, toast],
  )

  const logout = useCallback(async () => {
    try {
      await api.devLogout()
    } catch {
      /* 忽略 */
    }
    await refreshMe()
    toast('已退出，现在是访客视角', 'info')
  }, [refreshMe, toast])

  const setChefEnabled = useCallback(
    async (v: boolean) => {
      const prev = chefEnabled
      setChef(v)
      try {
        const s = await api.updateSettings({ chef_enabled: v })
        setChef(s.chef_enabled)
        toast(s.chef_enabled ? '厨驼上班啦！' : '厨驼下班了，之后都自己写', 'ok')
      } catch (e) {
        setChef(prev)
        handleError(e, '设置没保存上，再试一次')
      }
    },
    [chefEnabled, handleError, toast],
  )

  const value = useMemo<AppState>(
    () => ({
      ready,
      canEdit,
      email,
      chefEnabled,
      isMock: IS_MOCK,
      login,
      logout,
      refreshMe,
      setChefEnabled,
      refreshSettings,
      toast,
      handleError,
      toasts,
    }),
    [ready, canEdit, email, chefEnabled, login, logout, refreshMe, setChefEnabled, refreshSettings, toast, handleError, toasts],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useApp(): AppState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useApp 必须在 AppProvider 里用')
  return v
}
