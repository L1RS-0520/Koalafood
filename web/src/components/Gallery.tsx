// 漫画相册：手机左右滑（scroll-snap），电脑箭头/缩略图，点开看大图，显示“第 N/M 张”；1 张时不显示切换控件
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Photo } from '../api'
import { cx } from '../lib/util'
import { Icon } from './Icon'

function useSnapIndex(ref: React.RefObject<HTMLDivElement | null>, count: number) {
  const [idx, setIdx] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const on = () => {
      const i = Math.round(el.scrollLeft / Math.max(1, el.clientWidth))
      setIdx(Math.max(0, Math.min(count - 1, i)))
    }
    el.addEventListener('scroll', on, { passive: true })
    return () => el.removeEventListener('scroll', on)
  }, [ref, count])
  const go = useCallback(
    (i: number, smooth = true) => {
      const el = ref.current
      if (!el) return
      const n = (i + count) % count
      el.scrollTo({ left: n * el.clientWidth, behavior: smooth ? 'smooth' : 'auto' })
      setIdx(n)
    },
    [ref, count],
  )
  return [idx, go] as const
}

export function Gallery({ photos, name }: { photos: Photo[]; name: string }) {
  const track = useRef<HTMLDivElement>(null)
  const [idx, go] = useSnapIndex(track, photos.length)
  const [zoom, setZoom] = useState<number | null>(null)
  const multi = photos.length > 1

  if (photos.length === 0) {
    return (
      <div className="gallery gallery--empty">
        <Icon name="image" size={40} />
        <span>还没有照片</span>
      </div>
    )
  }

  return (
    <section className="gallery" aria-roledescription="相册" aria-label={`${name}的照片`}>
      <div className="gallery-frame">
        <span className="tape tape--l" aria-hidden="true" />
        <span className="tape tape--r" aria-hidden="true" />
        <div
          className="gallery-track"
          ref={track}
          tabIndex={multi ? 0 : -1}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') go(idx + 1)
            if (e.key === 'ArrowLeft') go(idx - 1)
          }}
        >
          {photos.map((p, i) => (
            <button
              key={p.id}
              type="button"
              className="gallery-slide"
              onClick={() => setZoom(i)}
              aria-label={`看大图：第 ${i + 1}/${photos.length} 张`}
            >
              <img src={p.url} alt={`${name} 第 ${i + 1} 张`} loading={i === 0 ? 'eager' : 'lazy'} decoding="async" draggable={false} />
            </button>
          ))}
        </div>
        {multi && (
          <>
            <button type="button" className="gallery-arrow gallery-arrow--l" onClick={() => go(idx - 1)} aria-label="上一张">
              <Icon name="left" />
            </button>
            <button type="button" className="gallery-arrow gallery-arrow--r" onClick={() => go(idx + 1)} aria-label="下一张">
              <Icon name="right" />
            </button>
            <span className="gallery-count">
              第 {idx + 1}/{photos.length} 张
            </span>
          </>
        )}
        <span className="gallery-zoom-hint" aria-hidden="true">
          <Icon name="expand" size={16} />
        </span>
      </div>
      {multi && (
        <>
          <div className="gallery-dots" aria-hidden="true">
            {photos.map((p, i) => (
              <i key={p.id} className={cx(i === idx && 'on')} />
            ))}
          </div>
          <div className="gallery-thumbs" role="tablist" aria-label="选择照片">
            {photos.map((p, i) => (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={i === idx}
                className={cx('gallery-thumb', i === idx && 'on')}
                onClick={() => go(i)}
                aria-label={`第 ${i + 1} 张`}
              >
                <img src={p.url} alt="" loading="lazy" />
              </button>
            ))}
          </div>
        </>
      )}
      {zoom !== null && <Lightbox photos={photos} start={zoom} name={name} onClose={(i) => (setZoom(null), go(i, false))} />}
    </section>
  )
}

function Lightbox({ photos, start, name, onClose }: { photos: Photo[]; start: number; name: string; onClose: (i: number) => void }) {
  const track = useRef<HTMLDivElement>(null)
  const [idx, go] = useSnapIndex(track, photos.length)
  const idxRef = useRef(start)
  idxRef.current = idx
  useEffect(() => {
    go(start, false)
    document.body.classList.add('no-scroll')
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose(idxRef.current)
      if (e.key === 'ArrowRight') go(idxRef.current + 1)
      if (e.key === 'ArrowLeft') go(idxRef.current - 1)
    }
    document.addEventListener('keydown', onKey)
    const closeBtn = document.querySelector<HTMLElement>('.lightbox-close')
    closeBtn?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.classList.remove('no-scroll')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const multi = photos.length > 1
  return createPortal(
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={`${name} 大图`}>
      <div className="lightbox-track" ref={track} onClick={(e) => e.target === e.currentTarget && onClose(idx)}>
        {photos.map((p, i) => (
          <div key={p.id} className="lightbox-slide" onClick={(e) => e.target === e.currentTarget && onClose(idx)}>
            <img src={p.url} alt={`${name} 第 ${i + 1} 张`} draggable={false} />
          </div>
        ))}
      </div>
      <button type="button" className="lightbox-close icon-btn" onClick={() => onClose(idx)} aria-label="关闭大图">
        <Icon name="close" />
      </button>
      {multi && (
        <>
          <span className="lightbox-count">
            第 {idx + 1}/{photos.length} 张
          </span>
          <button type="button" className="gallery-arrow gallery-arrow--l lightbox-arrow" onClick={() => go(idx - 1)} aria-label="上一张">
            <Icon name="left" />
          </button>
          <button type="button" className="gallery-arrow gallery-arrow--r lightbox-arrow" onClick={() => go(idx + 1)} aria-label="下一张">
            <Icon name="right" />
          </button>
        </>
      )}
    </div>,
    document.body,
  )
}
