// 后厨（/kitchen/*）守卫与登录页
import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ChefLlama } from '../components/ChefLlama'
import { Icon } from '../components/Icon'
import { Koala } from '../components/Koala'
import { PageLoading, Spinner, TopBar } from '../components/ui'
import { useApp } from '../lib/app'
import { useTitle } from '../lib/hooks'

export function KitchenOnly({ children }: { children: ReactNode }) {
  const app = useApp()
  if (!app.ready) return <PageLoading text="后厨开门中…" />
  if (!app.canEdit) return <KitchenClosed />
  return <>{children}</>
}

function KitchenClosed() {
  useTitle('后厨')
  const app = useApp()
  const [busy, setBusy] = useState(false)
  return (
    <main className="page page--narrow">
      <TopBar title="后厨" />
      <section className="kitchen-closed">
        <div className="kitchen-door" aria-hidden="true">
          <span className="kitchen-sign">STAFF ONLY</span>
          <Koala pose="point" size={110} />
          <ChefLlama pose="done" size={84} animated={false} />
        </div>
        <div className="bubble bubble--up">
          <h2>这里是后厨，大王专用</h2>
          <p>上传、编辑和设置都要大王登录后才能用。随便逛逛的话，前厅的菜随便看～</p>
        </div>
        <div className="center-actions">
          <button
            type="button"
            className="btn btn--primary btn--lg"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              await app.login()
              setBusy(false)
            }}
          >
            {busy ? <Spinner /> : <Icon name="key" size={20} />}
            大王登录
          </button>
          <Link className="btn btn--ghost" to="/">
            回前厅看菜
          </Link>
        </div>
      </section>
    </main>
  )
}

/** /kitchen/login：线上 Access 登录回来落在这里，再跳回 next */
export function KitchenLogin() {
  const app = useApp()
  const nav = useNavigate()
  const [params] = useSearchParams()
  const next = params.get('next') || '/'
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/'
  useEffect(() => {
    if (!app.ready) return
    if (app.canEdit) nav(safeNext, { replace: true })
  }, [app.ready, app.canEdit, nav, safeNext])
  if (!app.ready || app.canEdit) return <PageLoading text="正在进后厨…" />
  return <KitchenClosed />
}
