// 菜品卡片 v2（设计/2026-11-09-菜品卡片v2.png、视觉方向说明 §5.1，需求 F8、§6 P1）：只有封面 4:3 + 菜名。
// - 访客：没有任何状态（不显示蒙层、角标），待写、草稿中的菜也照常显示封面和菜名。
// - 大王：pending 加“厨驼正在写菜谱…”蒙层；draft 加“草稿待确认”贴纸；厨驼关闭时的 pending 不显示蒙层。
// - round-2 按产品审核 P1-1 去掉了分类胶囊、总时长和张数角标（卡片烹饪时间列入“待大王决定”）。
import { Link } from 'react-router-dom'
import { CHEF_STATUS, type DishSummary } from '../api'
import { cx } from '../lib/util'
import { ChefLlama, Dots } from './ChefLlama'
import { Icon } from './Icon'

export function DishCard({
  dish,
  canEdit,
  chefEnabled,
  index = 0,
}: {
  dish: DishSummary
  canEdit: boolean
  chefEnabled: boolean
  index?: number
}) {
  // 厨驼关闭时待写的菜不显示写作蒙层（§5.1），进详情页再提示“可以改为自己写”
  const writing = canEdit && chefEnabled && dish.chef_status === CHEF_STATUS.pending
  const draft = canEdit && dish.chef_status === CHEF_STATUS.draft
  return (
    <Link
      to={`/dishes/${encodeURIComponent(dish.id)}`}
      className={cx('card', 'card--sm', writing && 'card--pending')}
      style={{ '--i': index } as React.CSSProperties}
      aria-label={`${dish.name}${writing ? '，厨驼正在写菜谱' : draft ? '，草稿待确认' : ''}`}
    >
      <div className="card-cover">
        {dish.photo_url ? (
          <img src={dish.photo_url} alt="" loading="lazy" decoding="async" />
        ) : (
          <div className="card-cover-empty" aria-hidden="true">
            <Icon name="image" size={36} />
            <span>还没有照片哦</span>
          </div>
        )}
        {writing && (
          <div className="card-chef">
            <span className="card-chef-avatar">
              <ChefLlama pose="write" size={44} />
            </span>
            <span className="card-chef-text">厨驼正在写菜谱…</span>
            <Dots />
          </div>
        )}
        {draft && (
          <span className="card-stamp">
            <i aria-hidden="true" />
            草稿待确认
          </span>
        )}
      </div>
      <div className="card-body">
        <h3 className="card-name">{dish.name}</h3>
      </div>
    </Link>
  )
}

export function DishCardSkeleton({ index = 0 }: { index?: number }) {
  return (
    <div className="card card--sm card--skeleton" style={{ '--i': index } as React.CSSProperties} aria-hidden="true">
      <div className="card-cover shimmer" />
      <div className="card-body">
        <div className="sk-line shimmer" />
      </div>
    </div>
  )
}
