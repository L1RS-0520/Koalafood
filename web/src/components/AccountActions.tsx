// 顶栏右侧身份区（设计 §5.2）：访客只有「大王登录」；大王是齿轮（设置）+ 黑底「大王」胶囊（点开可退出）。
// 首页和详情页共用（走查 P2-2：详情页右侧也要有）。
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../lib/app'
import { Icon } from './Icon'
import { Koala } from './Koala'
import { Confirm } from './ui'

export function AccountActions() {
  const app = useApp()
  const [bye, setBye] = useState(false)
  if (!app.canEdit) {
    return app.ready ? (
      <button type="button" className="login-pill" onClick={() => app.login()}>
        <Icon name="crown" size={14} />
        大王登录
      </button>
    ) : null
  }
  return (
    <>
      <Link to="/kitchen/settings" className="icon-btn" aria-label="设置">
        <Icon name="gear" />
      </Link>
      <button type="button" className="king-pill" onClick={() => setBye(true)} aria-label="大王已登录，点开可退出登录">
        <Icon name="crown" size={14} />
        大王
      </button>
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
    </>
  )
}
