// 菜品卡片（按设计稿：4:3 封面、3px 墨线、4px 硬投影、略随机倾斜的贴纸感）
import { Link } from 'react-router-dom'
import { CHEF_STATUS, type DishSummary } from '../api'
import { categoryTone } from '../lib/category'
import { coverBubble, cx, relDate, tilt } from '../lib/util'
import { ChefLlama } from './ChefLlama'
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
  const pending = canEdit && dish.chef_status === CHEF_STATUS.pending
  const draft = canEdit && dish.chef_status === CHEF_STATUS.draft
  const bubble = !pending && !draft ? coverBubble(dish.id, dish.category) : null
  return (
    <Link
      to={`/dishes/${encodeURIComponent(dish.id)}`}
      className={cx('card', 'card--sm', pending && 'card--pending')}
      style={{ '--tilt': `${tilt(dish.id)}deg`, '--i': index } as React.CSSProperties}
      aria-label={`${dish.name}${pending ? '，厨驼正在写菜谱' : draft ? '，草稿待确认' : ''}`}
    >
      <div className="card-cover">
        {dish.photo_url ? (
          <img src={dish.photo_url} alt="" loading="lazy" decoding="async" />
        ) : (
          <div className="card-cover-empty" aria-hidden="true">
            <Icon name="image" size={36} />
          </div>
        )}
        {bubble && <span className="card-bubble">{bubble}</span>}
        {dish.photo_count > 1 && (
          <span className="card-count" title={`${dish.photo_count} 张照片`}>
            <Icon name="photos" size={14} />
            {dish.photo_count}
          </span>
        )}
        {pending && (
          <div className={cx('card-chef', !chefEnabled && 'card-chef--off')}>
            {chefEnabled ? (
              <>
                <ChefLlama pose="wok" size={58} />
                <span className="card-chef-text">厨驼正在写菜谱…</span>
              </>
            ) : (
              <span className="card-chef-text">等大王自己写</span>
            )}
          </div>
        )}
        {draft && <span className="card-stamp">草稿待确认</span>}
      </div>
      <div className="card-body">
        <h3 className="card-name">{dish.name}</h3>
        <div className="card-meta">
          <span className={cx('tag', `tag--${categoryTone(dish.category)}`)}>{dish.category}</span>
          <span className="card-date">{relDate(dish.created_at)}</span>
        </div>
      </div>
    </Link>
  )
}

export function DishCardSkeleton({ index = 0 }: { index?: number }) {
  return (
    <div className="card card--sm card--skeleton" style={{ '--tilt': '0deg', '--i': index } as React.CSSProperties} aria-hidden="true">
      <div className="card-cover shimmer" />
      <div className="card-body">
        <div className="sk-line shimmer" />
        <div className="sk-line sk-line--short shimmer" />
      </div>
    </div>
  )
}
