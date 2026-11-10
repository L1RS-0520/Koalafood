// P5 设置（仅大王）：一个开关「找厨驼写菜谱」
import { useState } from 'react'
import { ChefLlama } from '../components/ChefLlama'
import { Icon } from '../components/Icon'
import { Confirm, TopBar } from '../components/ui'
import { resetMock } from '../api/mock'
import { useApp } from '../lib/app'
import { useTitle } from '../lib/hooks'
import { cx } from '../lib/util'

export function SettingsPage() {
  useTitle('设置')
  const app = useApp()
  const [busy, setBusy] = useState(false)
  const [askReset, setAskReset] = useState(false)
  const on = app.chefEnabled
  const toggle = async () => {
    setBusy(true)
    await app.setChefEnabled(!on)
    setBusy(false)
  }
  return (
    <main className="page page--narrow">
      <TopBar title="设置" />
      <section className={cx('setting-card', !on && 'setting-card--off')}>
        <div className="setting-art">
          <ChefLlama pose={on ? 'wok' : 'sleep'} size={120} animated={on} />
          <span className={cx('setting-sign', on ? 'on' : 'off')}>{on ? '营业中' : '下班了'}</span>
        </div>
        <div className="setting-row">
          <div className="setting-text">
            <h2 id="chef-switch-label">找厨驼写菜谱</h2>
            <p>{on ? '上传时可以把菜交给厨驼写食材和步骤，写好后等你确认。' : '已关闭：上传、编辑、详情页都不会出现厨驼的入口，全部自己写。已有菜谱不受影响。'}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-labelledby="chef-switch-label"
            className={cx('switch', on && 'on')}
            onClick={toggle}
            disabled={busy}
          >
            <span className="switch-knob" />
            <span className="switch-txt">{on ? '开' : '关'}</span>
          </button>
        </div>
      </section>

      <section className="setting-foot">
        {app.email && <p>已登录：{app.email}</p>}
        <button type="button" className="btn btn--text" onClick={() => app.logout()}>
          <Icon name="logout" size={18} />
          退出登录
        </button>
        {app.isMock && (
          <>
            <button type="button" className="btn btn--text" onClick={() => setAskReset(true)}>
              <Icon name="refresh" size={18} />
              重置本地示例数据
            </button>
            <p className="dim">当前是本地模拟数据（VITE_MOCK=1），只存在这个浏览器里。</p>
          </>
        )}
      </section>
      <Confirm
        open={askReset}
        title="重置示例数据？"
        body="本地模拟数据会恢复成 8 道示例菜，你在 mock 里加的菜会被清掉。"
        okText="重置"
        danger
        onOk={() => {
          resetMock()
          window.location.href = '/'
        }}
        onCancel={() => setAskReset(false)}
      />
    </main>
  )
}
