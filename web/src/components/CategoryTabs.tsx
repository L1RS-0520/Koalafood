// 分类标签栏：横滑、选中项自动滚到可见；走 ?category=
import { useEffect, useRef } from 'react'
import { ALL, CATEGORIES } from '../api'
import { cx } from '../lib/util'

export function CategoryTabs({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>('[aria-selected="true"]')
    el?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
  }, [value])
  return (
    <nav className="tabs-wrap" aria-label="菜品分类">
      <div className="tabs" role="tablist" ref={ref}>
        {[ALL, ...CATEGORIES].map((c) => (
          <button
            key={c}
            type="button"
            role="tab"
            aria-selected={value === c}
            className={cx('tab', value === c && 'tab--on')}
            onClick={() => onChange(c)}
          >
            {c}
          </button>
        ))}
      </div>
    </nav>
  )
}
