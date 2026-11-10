// 全站顶栏（设计/2026-11-10-A定稿-前端规范 §5.1）：纸色底 + 1.5px 底边，手机高 56、电脑高 64。
// 左为横版 Logo（手机 40 / 电脑 44）；右侧热区一律 44×44。
import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import logoBar from '../assets/logo-bar.svg'
import { cx } from '../lib/util'
import { Icon } from './Icon'

export function BrandLink({ className }: { className?: string }) {
  return (
    <Link to="/" className={cx('brand', className)} aria-label="考拉食堂首页">
      <img src={logoBar} alt="考拉食堂" className="brand-logo" />
    </Link>
  )
}

export function SiteHeader({
  align = 'start',
  left,
  right,
}: {
  /** start：Logo 靠左（首页）；center：Logo 居中，左右放返回和菜单（详情） */
  align?: 'start' | 'center'
  left?: ReactNode
  right?: ReactNode
}) {
  return (
    <header className={cx('site-head', align === 'center' && 'site-head--center')}>
      <div className="site-head-inner">
        <div className="site-head-side site-head-left">{left ?? <BrandLink />}</div>
        {align === 'center' && <BrandLink className="site-head-center-brand" />}
        <div className="site-head-side site-head-right">{right}</div>
      </div>
    </header>
  )
}

export function BackButton({ to = '/' }: { to?: string }) {
  const nav = useNavigate()
  return (
    <button
      type="button"
      className="hit"
      aria-label="返回"
      onClick={() => (window.history.length > 1 && window.history.state?.idx > 0 ? nav(-1) : nav(to))}
    >
      <Icon name="back" />
    </button>
  )
}
