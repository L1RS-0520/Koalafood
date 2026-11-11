// 首页（设计/2026-11-10-A定稿）：顶栏 + 分类 + 卡片墙。不再使用悬浮「上传新菜」和横向分类胶囊。
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ALL, api, CATEGORIES, CHEF_STATUS, POLL_MS, type DishSummary } from '../api'
import { AccountActions } from '../components/AccountActions'
import { CategoryTabs } from '../components/CategoryTabs'
import { DishCard, DishCardSkeleton } from '../components/DishCard'
import { Icon } from '../components/Icon'
import { SiteHeader } from '../components/SiteHeader'
import { StatePanel } from '../components/ui'
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

  const { canEdit, toast } = app
  const load = useCallback(
    async (silent = false) => {
      if (!silent) {
        setDishes(null)
        setError(null)
      }
      try {
        const list = await api.listDishes(category)
        if (silent && canEdit) {
          const done = list.filter(
            (d) => prevStatus.current.get(d.id) === CHEF_STATUS.pending && d.chef_status === CHEF_STATUS.draft,
          )
          if (done.length) toast(`厨驼交稿啦：${done.map((d) => d.name).join('、')}`, 'ok')
        }
        prevStatus.current = new Map(list.map((d) => [d.id, d.chef_status]))
        setDishes(list)
      } catch (e) {
        if (!silent) setError(e instanceof Error ? e.message : '菜单没加载出来')
      }
    },
    [category, canEdit, toast],
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
      <SiteHeader
        right={
          <>
            {app.canEdit && (
              <Link to="/kitchen/upload" className="hit hit-text">
                上传
              </Link>
            )}
            <AccountActions />
          </>
        }
      />

      <div className="home-page">
        <h1 className="visually-hidden">{category === ALL ? '全部菜品' : category}</h1>
        <CategoryTabs value={category} onChange={pick} count={dishes?.length ?? null} />

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
            app.canEdit ? (
              <StatePanel
                pose="point"
                title="食堂还空着，上传第一道菜吧。"
                action={
                  <Link className="btn btn--primary btn--lg" to="/kitchen/upload">
                    <Icon name="plus" size={20} />
                    上传新菜
                  </Link>
                }
              />
            ) : (
              <StatePanel pose="point" title="食堂还没开张呢，过几天再来看看～" />
            )
          ) : app.canEdit ? (
            <StatePanel
              pose="taste"
              title={`${category}还没有菜`}
              text="换个分类看看，或者给这里添一道。"
              action={
                <Link className="btn btn--primary" to={`/kitchen/upload?category=${encodeURIComponent(category)}`}>
                  <Icon name="plus" size={18} />
                  上传新菜
                </Link>
              }
            />
          ) : (
            <StatePanel pose="taste" title="这个分类还空着～" text={`考拉大王还没做过${category}，先去别的分类看看吧！`} />
          )
        ) : (
          <div className="grid">
            {dishes.map((d, i) => (
              <DishCard key={d.id} dish={d} canEdit={app.canEdit} chefEnabled={app.chefEnabled} index={i} />
            ))}
          </div>
        )}
      </div>

      <footer className="foot">
        <span>考拉食堂</span>
        {app.isMock && <span className="mock-chip">本地模拟数据</span>}
      </footer>
    </main>
  )
}
