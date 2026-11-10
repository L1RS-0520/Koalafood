// 多图管理：预览网格、删除、拖动排序（指针事件，手机可用）+ 前移/后移/设封面按钮兜底；第一张为封面
import { useRef, useState } from 'react'
import { LIMITS } from '../api'
import { cx, formatBytes } from '../lib/util'
import { Icon } from './Icon'
import { Confirm, Spinner } from './ui'

export interface PhotoItem {
  key: string
  url: string
  /** 不合格原因（提交前逐张校验时标出） */
  bad?: string | null
}

export const HEIC_TIP = 'iPhone 可以在「设置 > 相机 > 格式」里选「兼容性最佳」，以后拍的就是 JPG 了'

/** 校验选中的文件：返回可用文件 + 中文错误 */
export function checkFiles(files: File[], existing: number): { ok: File[]; errors: string[] } {
  const ok: File[] = []
  const errors: string[] = []
  for (const f of files) {
    if (/heic|heif/i.test(f.type) || /\.(heic|heif)$/i.test(f.name)) {
      errors.push(`「${f.name}」是 HEIC 格式，请换成 JPG 或 PNG 再传（${HEIC_TIP}）`)
      continue
    }
    if (!(LIMITS.photoTypes as readonly string[]).includes(f.type)) {
      errors.push(`「${f.name}」不是 jpg/png/webp 格式的照片`)
      continue
    }
    if (f.size > LIMITS.photoMaxBytes) {
      errors.push(`「${f.name}」有 ${formatBytes(f.size)}，单张不能超过 10MB`)
      continue
    }
    if (existing + ok.length >= LIMITS.photosMax) {
      errors.push(`最多 ${LIMITS.photosMax} 张照片，多出来的 ${files.length - files.indexOf(f)} 张没加上`)
      break
    }
    ok.push(f)
  }
  return { ok, errors }
}

export function PhotoManager({
  items,
  onAdd,
  onRemove,
  onMove,
  busy,
  error,
  invalid,
  progress,
}: {
  items: PhotoItem[]
  onAdd: (files: File[]) => void
  onRemove: (key: string) => void
  onMove: (from: number, to: number) => void
  busy?: boolean
  error?: string | null
  invalid?: boolean
  /** 压缩进度，如 {done:1,total:3} */
  progress?: { done: number; total: number } | null
}) {
  const album = useRef<HTMLInputElement>(null)
  const camera = useRef<HTMLInputElement>(null)
  const [drag, setDrag] = useState<{ from: number; over: number; dx: number; dy: number } | null>(null)
  const start = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const full = items.length >= LIMITS.photosMax
  const [askDel, setAskDel] = useState<number | null>(null)

  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (files.length) onAdd(files)
  }

  const onDown = (i: number) => (e: React.PointerEvent) => {
    if (busy || items.length < 2) return
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    start.current = { x: e.clientX, y: e.clientY }
    setDrag({ from: i, over: i, dx: 0, dy: 0 })
  }
  const onMoveP = (e: React.PointerEvent) => {
    if (!drag) return
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-photo-idx]')
    const over = el ? Number(el.dataset.photoIdx) : drag.over
    setDrag({ ...drag, over, dx: e.clientX - start.current.x, dy: e.clientY - start.current.y })
  }
  const onUp = () => {
    if (drag && drag.over !== drag.from) onMove(drag.from, drag.over)
    setDrag(null)
  }

  return (
    <div className={cx('photos', invalid && 'is-invalid')}>
      <ul className="photo-grid" aria-label="已选照片，第一张为封面">
        {items.map((p, i) => {
          const dragging = drag?.from === i
          const target = drag && drag.over === i && drag.from !== i
          return (
            <li
              key={p.key}
              data-photo-idx={i}
              className={cx('photo-tile', i === 0 && 'photo-tile--cover', dragging && 'is-dragging', target && 'is-target', p.bad && 'is-bad')}
              style={dragging ? { transform: `translate(${drag.dx}px, ${drag.dy}px) rotate(-3deg)` } : undefined}
            >
              <img src={p.url} alt={`第 ${i + 1} 张`} draggable={false} />
              {i === 0 && <span className="photo-cover-tag">封面</span>}
              {p.bad && (
                <span className="photo-bad" role="alert">
                  {p.bad}
                </span>
              )}
              {items.length > 1 && (
                <button
                  type="button"
                  className="photo-grip"
                  aria-label={`拖动调整第 ${i + 1} 张的位置`}
                  onPointerDown={onDown(i)}
                  onPointerMove={onMoveP}
                  onPointerUp={onUp}
                  onPointerCancel={() => setDrag(null)}
                >
                  <Icon name="grip" size={18} />
                </button>
              )}
              <button
                type="button"
                className="photo-del"
                aria-label={`删除第 ${i + 1} 张`}
                disabled={busy || items.length <= 1}
                title={items.length <= 1 ? '至少要留 1 张照片' : '删除'}
                onClick={() => setAskDel(i)}
              >
                <Icon name="close" size={16} />
              </button>
              {items.length > 1 && (
                <div className="photo-tools">
                  <button type="button" aria-label="往前挪" disabled={busy || i === 0} onClick={() => onMove(i, i - 1)}>
                    <Icon name="left" size={16} />
                  </button>
                  {i !== 0 && (
                    <button type="button" className="photo-setcover" disabled={busy} onClick={() => onMove(i, 0)}>
                      设封面
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label="往后挪"
                    disabled={busy || i === items.length - 1}
                    onClick={() => onMove(i, i + 1)}
                  >
                    <Icon name="right" size={16} />
                  </button>
                </div>
              )}
            </li>
          )
        })}
        {!full && (
          <li className="photo-add">
            <button type="button" className="photo-add-btn" onClick={() => album.current?.click()} disabled={busy}>
              {busy ? <Spinner /> : <Icon name="image" size={28} />}
              <span>{progress ? `压缩中 ${progress.done}/${progress.total}` : busy ? '处理中…' : items.length ? '再加几张' : '从相册选'}</span>
            </button>
            <button type="button" className="photo-cam-btn" onClick={() => camera.current?.click()} disabled={busy}>
              <Icon name="camera" size={18} />
              拍照
            </button>
          </li>
        )}
      </ul>
      {progress && (
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done} aria-label="照片压缩进度">
          <i style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
          <span>正在压缩照片 {progress.done}/{progress.total}（长边 1600px、单张 ≤1MB）</span>
        </div>
      )}
      <input ref={album} type="file" accept="image/jpeg,image/png,image/webp,.heic,.heif" multiple hidden onChange={pick} />
      <input ref={camera} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden onChange={pick} />
      <p className="field-hint">
        {items.length}/{LIMITS.photosMax} 张 · jpg/png/webp，单张 ≤10MB（上传前自动压缩）· 第一张是封面
        {items.length > 1 && '，按住 ⠿ 拖动或用箭头调整顺序'}
      </p>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <Confirm
        open={askDel !== null}
        title={`删掉第 ${(askDel ?? 0) + 1} 张照片？`}
        body={
          askDel !== null && items[askDel] ? (
            <div className="del-preview">
              <img src={items[askDel].url} alt="" />
              {askDel === 0 && items.length > 1 && <p>它是封面，删掉后第 2 张会变成封面。</p>}
            </div>
          ) : null
        }
        okText="删掉"
        cancelText="留着"
        danger
        onOk={() => {
          if (askDel !== null && items[askDel]) onRemove(items[askDel].key)
          setAskDel(null)
        }}
        onCancel={() => setAskDel(null)}
      />
    </div>
  )
}
