// P1 首页 / 分类浏览（设计/2026-11-09-首页分类页.png）：手机顶部横滑分类，桌面左侧分类栏
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ALL, api, CATEGORIES, CHEF_STATUS, POLL_MS, type DishSummary } from '../api'
import { CategoryTabs } from '../components/CategoryTabs'
import { DishCard, DishCardSkeleton } from '../components/DishCard'
import { Icon } from '../components/Icon'
import { Koala } from '../components/Koala'
import { Confirm, StatePanel } from '../components/ui'
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

  const [bye, setBye] = useState(false)
  const drafts = dishes?.filter((d) => d.chef_status === CHEF_STATUS.draft).length ?? 0
  const greeting = app.canEdit
    ? drafts
      ? `大王回来啦！${drafts} 道草稿等你确认～`
      : '大王回来啦！今天想记哪道菜？'
    : '欢迎来考拉食堂！大王做过的菜都在这里～'
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
          <img src={logo} alt="" width={40} height={40} className="brand-logo" />
          <span className="brand-name">考拉食堂</span>
        </Link>
        <div className="home-actions">
          {app.canEdit && (
            <Link to="/kitchen/upload" className="btn btn--primary btn--sm home-upload">
              <Icon name="plus" size={18} />
              上传新菜
            </Link>
          )}
          {app.canEdit ? (
            <>
              <Link to="/kitchen/settings" className="icon-btn" aria-label="设置">
                <Icon name="gear" />
              </Link>
              <button type="button" className="king-pill" onClick={() => setBye(true)} aria-label="大王已登录，点开可退出登录">
                <Icon name="crown" size={14} />
                大王
              </button>
            </>
          ) : (
            app.ready && (
              <button type="button" className="login-pill" onClick={() => app.login()}>
                <Icon name="crown" size={14} />
                大王登录
              </button>
            )
          )}
        </div>
      </header>

      <div className="home-body">
        <aside className="home-side">
          <p className="side-title">分类</p>
          <CategoryTabs value={category} onChange={pick} />
          <div className="side-koala" aria-hidden="true">
            <Koala pose="point" size={64} />
            <span className="bubble bubble--left">选个分类看看吧！</span>
          </div>
        </aside>

        <div className="home-main">
      <div className="greet">
        <Koala pose={app.canEdit ? 'spoon' : 'wave'} size={64} />
        <p className="bubble bubble--left">{greeting}</p>
      </div>

      <h1 className="home-title">
        {category}
        {dishes && <small>{dishes.length} 道 · 按上传时间倒序</small>}
      </h1>

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
          // 分类空（设计 空状态.png ①②、§5.10，走查 P1-5）：访客没有上传权限，不提“添一道”、不放按钮；
          // 大王给「＋ 上传新菜」，进上传页时预选当前分类
          app.canEdit ? (
            <StatePanel
              pose="taste"
              title={`${category}还没有菜`}
              text="做了好吃的？拍张照传上来吧～"
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
        )
      ) : (
        <div className="grid">
          {dishes.map((d, i) => (
            <DishCard key={d.id} dish={d} canEdit={app.canEdit} chefEnabled={app.chefEnabled} index={i} />
          ))}
        </div>
      )}

        </div>
      </div>

      <footer className="foot">
        <span>考拉食堂 · 大王的漫画菜谱本</span>
        {app.isMock && <span className="mock-chip">本地模拟数据</span>}
      </footer>

      <Confirm
        open={bye}
        title="退出大王登录？"
        body="退出后就和访客看到的一样，草稿和后厨入口都会藏起来。"
        okText="退出登录"
        cancelText="留下"
        art={<Koala pose="wave" size={76} />}
        onOk={() => {
          setBye(false)
          app.logout()
        }}
        onCancel={() => setBye(false)}
      />

      {app.canEdit && (
        <Link to="/kitchen/upload" className="fab" aria-label="上传新菜">
          <Icon name="plus" size={24} />
          <span>上传新菜</span>
        </Link>
      )}
    </main>
  )
}
