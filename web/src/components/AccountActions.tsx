// 顶栏右侧身份区（规范 §5.1）：访客是文字「登录」；大王是设置齿轮。退出在设置页。
import { Link } from 'react-router-dom'
import { useApp } from '../lib/app'
import { Icon } from './Icon'

export function AccountActions() {
  const app = useApp()
  if (!app.canEdit) {
    return app.ready ? (
      <button type="button" className="hit hit-text" onClick={() => app.login()}>
        登录
      </button>
    ) : null
  }
  return (
    <Link to="/kitchen/settings" className="hit" aria-label="设置">
      <Icon name="gear" size={22} />
    </Link>
  )
}
