// P1 首页 / 菜品墙
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ALL, api, CATEGORIES, CHEF_STATUS, POLL_MS, type DishSummary } from '../api'
import { CategoryTabs } from '../components/CategoryTabs'
import { ChefLlama } from '../components/ChefLlama'
import { DishCard, DishCardSkeleton } from '../components/DishCard'
import { Icon } from '../components/Icon'
import { Koala } from '../components/Koala'
import { StatePanel } from '../components/ui'
import logo from '../assets/logo.webp'
import { useApp } from '../lib/app'
import { usePolling, useTitle } from '../lib/hooks'

export function HomePage() {
  useTitle('')
  const app = useApp()
  const [params, setParams] = useSearchParams()
  const raw = params.get('category') ?? ALL
  const category = (CATEGORIES as readonly string[]).includes(raw) ? raw : ALL
  const [dishes, setDishes] = useState<DishSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const prevStatus = useRef<Map<string, string>>(new Map())

  const load = useCallback(
    async (silent = false) => {
      if (!silent) {
        setDishes(null)
        setError(null)
      }
      try {
        const list = await api.listDishes(category)
        // 轮询发现交稿：提示一下
        if (silent && app.canEdit) {
          const done = list.filter(
            (d) => prevStatus.current.get(d.id) === CHEF_STATUS.pending && d.chef_status === CHEF_STATUS.draft,
          )
          if (done.length) app.toast(`厨驼交稿啦：${done.map((d) => d.name).join('、')}`, 'ok')
        }
        prevStatus.current = new Map(list.map((d) => [d.id, d.chef_status]))
        setDishes(list)
      } catch (e) {
        if (!silent) setError(e instanceof Error ? e.message : '菜单没加载出来')
      }
    },
    [category, app],
  )

  useEffect(() => {
    load()
  }, [load])

  const hasPending = !!dishes?.some((d) => d.chef_status === CHEF_STATUS.pending)
  usePolling(() => load(true), POLL_MS, hasPending && app.chefEnabled)

  const pick = (c: string) => {
    const next = new URLSearchParams(params)
    if (c === ALL) next.delete('category')
    else next.set('category', c)
    setParams(next, { replace: true })
  }

  return (
    <main className="page page--home">
      <header className="home-head">
        <Link to="/" className="brand" aria-label="考拉食堂首页">
          <img src={logo} alt="" width={52} height={52} className="brand-logo" />
          <span className="brand-text">
            <span className="brand-name">考拉食堂</span>
            <span className="brand-en">KOALA CANTEEN</span>
          </span>
        </Link>
        <div className="home-actions">
          {app.canEdit ? (
            <Link to="/kitchen/settings" className="icon-btn" aria-label="设置">
              <Icon name="gear" />
            </Link>
          ) : (
            app.ready && (
              <button type="button" className="login-link" onClick={() => app.login()}>
                <Icon name="key" size={18} />
                大王登录
              </button>
            )
          )}
        </div>
      </header>

      <section className="hero" aria-label="今日食堂">
        <div className="hero-bubble bubble">
          <b>今天吃什么？</b>
          <span>{dishes ? (dishes.length ? `${category === ALL ? '食堂' : category}里有 ${dishes.length} 道菜` : '还空着呢') : '翻菜单中…'}</span>
        </div>
        <Koala pose="wave" size={92} className="hero-koala" />
        <ChefLlama pose="idle" size={70} className="hero-llama" animated={false} />
        <span className="hero-pop" aria-hidden="true">
          YUM!
        </span>
      </section>

      <CategoryTabs value={category} onChange={pick} />

      {error ? (
        <StatePanel
          pose="think"
          title="菜单没端上来"
          text={error}
          action={
            <button type="button" className="btn btn--primary" onClick={() => load()}>
              <Icon name="refresh" size={18} />
              再试一次
            </button>
          }
        />
      ) : dishes === null ? (
        <div className="grid" aria-busy="true" aria-label="加载中">
          {Array.from({ length: 6 }, (_, i) => (
            <DishCardSkeleton key={i} index={i} />
          ))}
        </div>
      ) : dishes.length === 0 ? (
        category === ALL ? (
          <StatePanel
            pose="point"
            title="食堂还没开张，快上传第一道菜"
            text={app.canEdit ? '拍张照、写个菜名就行，菜谱可以交给厨驼。' : '大王还没上新菜，过会儿再来看看吧。'}
            action={
              app.canEdit && (
                <Link className="btn btn--primary btn--lg" to="/kitchen/upload">
                  <Icon name="plus" size={20} />
                  上传第一道菜
                </Link>
              )
            }
          />
        ) : (
          <StatePanel
            pose="taste"
            title={`「${category}」还没有菜`}
            text="换个分类看看，或者给这里添一道。"
            action={
              <button type="button" className="btn btn--ghost" onClick={() => pick(ALL)}>
                看全部菜品
              </button>
            }
          />
        )
      ) : (
        <div className="grid">
          {dishes.map((d, i) => (
            <DishCard key={d.id} dish={d} canEdit={app.canEdit} chefEnabled={app.chefEnabled} index={i} />
          ))}
        </div>
      )}

      <footer className="foot">
        <span>考拉食堂 · 大王的漫画菜谱本</span>
        {app.isMock && <span className="mock-chip">本地模拟数据</span>}
        {app.canEdit && (
          <button type="button" className="foot-link" onClick={() => app.logout()}>
            退出登录
          </button>
        )}
      </footer>

      {app.canEdit && (
        <Link to="/kitchen/upload" className="fab" aria-label="上传新菜">
          <Icon name="plus" size={24} />
          <span>上传新菜</span>
        </Link>
      )}
    </main>
  )
}
