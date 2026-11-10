// 菜品卡片 v2（设计/2026-11-09-菜品卡片v2.png）：封面 4:3 + 菜名 + 分类胶囊 + 总时长（有才显示）+ 多图张数；
// 状态（草稿待确认贴纸 / 写作中蒙层）和分类/时长只给大王看；访客卡片只有封面 + 菜名（设计 v2.4.3）。
import { Link } from 'react-router-dom'
import { CHEF_STATUS, type DishSummary } from '../api'
import { categoryTone } from '../lib/category'
import { cx } from '../lib/util'
import { ChefLlama, Dots } from './ChefLlama'
import { Icon } from './Icon'

/** “40分钟（另可冷藏30分钟）” → “40分钟” */
const shortTime = (t?: string | null) => (t ? t.split(/[（(]/)[0].trim() : '')

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
  const time = shortTime(dish.total_time)
  return (
    <Link
      to={`/dishes/${encodeURIComponent(dish.id)}`}
      className={cx('card', 'card--sm', pending && 'card--pending')}
      style={{ '--i': index } as React.CSSProperties}
      aria-label={`${dish.name}${pending ? '，厨驼正在写菜谱' : draft ? '，草稿待确认' : ''}`}
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
        {dish.photo_count > 1 && (
          <span className="card-count" title={`${dish.photo_count} 张照片`}>
            <Icon name="photos" size={13} />
            {dish.photo_count}
          </span>
        )}
        {pending && (
          <div className={cx('card-chef', !chefEnabled && 'card-chef--off')}>
            {chefEnabled ? (
              <>
                <span className="card-chef-avatar">
                  <ChefLlama pose="write" size={44} />
                </span>
                <span className="card-chef-text">厨驼正在写菜谱…</span>
                <Dots />
              </>
            ) : (
              <span className="card-chef-text">待写 · 可以自己写</span>
            )}
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
        {canEdit && (
        <div className="card-meta">
          <span className={cx('tag', `tag--${categoryTone(dish.category)}`)}>{dish.category}</span>
          {time && (
            <span className="card-time">
              <Icon name="clock" size={14} />
              {time}
            </span>
          )}
        </div>
        )}
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
        <div className="sk-line sk-line--short shimmer" />
      </div>
    </div>
  )
}
