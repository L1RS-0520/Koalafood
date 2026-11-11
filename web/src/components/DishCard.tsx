// 菜品卡片（规范 §5.2）：封面 + 菜名。访客只有封面和菜名；大王状态用菜名旁 12px 次要色文字。
import { Link } from 'react-router-dom'
import { CHEF_STATUS, type DishSummary } from '../api'
import { cx } from '../lib/util'
import { Icon } from './Icon'

function statusFlag(dish: DishSummary, canEdit: boolean, chefEnabled: boolean): string | null {
  if (!canEdit) return null
  if (chefEnabled && dish.chef_status === CHEF_STATUS.pending) return '厨驼正在写'
  if (dish.chef_status === CHEF_STATUS.draft) return '草稿'
  return null
}

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
  const flag = statusFlag(dish, canEdit, chefEnabled)
  const writing = flag === '厨驼正在写'
  const draft = flag === '草稿'
  return (
    <Link
      to={`/dishes/${encodeURIComponent(dish.id)}`}
      className={cx('card')}
      style={{ '--i': index } as React.CSSProperties}
      aria-label={`${dish.name}${writing ? '，厨驼正在写菜谱' : draft ? '，草稿' : ''}`}
    >
      <div className="card-pic">
        {dish.photo_url ? (
          <img src={dish.photo_url} alt="" loading="lazy" decoding="async" />
        ) : (
          <div className="card-cover-empty" aria-hidden="true">
            <Icon name="image" size={36} />
            <span>还没有照片哦</span>
          </div>
        )}
      </div>
      <div className="card-meta">
        <h3 className="card-name">{dish.name}</h3>
        {flag && <span className="card-flag">{flag}</span>}
      </div>
    </Link>
  )
}

export function DishCardSkeleton({ index = 0 }: { index?: number }) {
  return (
    <div className="card card--skeleton" style={{ '--i': index } as React.CSSProperties} aria-hidden="true">
      <div className="card-pic shimmer" />
      <div className="card-meta">
        <div className="sk-line shimmer" />
      </div>
    </div>
  )
}
