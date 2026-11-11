// 分类入口（规范 §5.2）：手机「全部分类 ▾」下拉，电脑一行文字分类。7 个分类都在。
import { useEffect, useRef, useState } from 'react'
import { ALL, CATEGORIES } from '../api'
import { cx } from '../lib/util'

const OPTIONS = [ALL, ...CATEGORIES]

export function CategoryTabs({
  value,
  onChange,
  count,
}: {
  value: string
  onChange: (c: string) => void
  count?: number | null
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const label = value === ALL ? '全部分类' : value

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <>
      <div className="cat-toolbar" ref={box}>
        <button
          type="button"
          className="cat-btn"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={`分类：${label}`}
          onClick={() => setOpen((v) => !v)}
        >
          {label}
          <span className="cat-chev" aria-hidden="true">
            ▾
          </span>
        </button>
        {count != null && <span className="cat-count">{count} 道</span>}
        {open && (
          <ul className="cat-menu" role="listbox" aria-label="菜品分类">
            {OPTIONS.map((c) => {
              const text = c === ALL ? '全部分类' : c
              return (
                <li key={c} role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={value === c}
                    className={cx('cat-option', value === c && 'is-on')}
                    onClick={() => {
                      onChange(c)
                      setOpen(false)
                    }}
                  >
                    {text}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      <nav className="cats-row" aria-label="分类">
        {OPTIONS.map((c) => (
          <button type="button" key={c} className={cx('cats-link', value === c && 'is-on')} onClick={() => onChange(c)}>
            {c}
          </button>
        ))}
      </nav>
    </>
  )
}
