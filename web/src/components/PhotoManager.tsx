// 多图管理：预览网格、删除、拖动排序（指针事件，手机可用）+ 前移/后移/设封面按钮兜底；第一张为封面
// round-2（设计 2026-11-10-上传页-照片校验与压缩 ①②③）：不合格的照片也放进网格标红并写原因，
// 照片区下方列出“第几张 · 怎么办”；压缩中每张显示排队中 / 进度环百分比，完成后显示压缩后大小。
import { useRef, useState } from 'react'
import { heicPhotoText, isHeic, LIMITS, tooBigPhotoText } from '../api'
import { extLabel, type PhotoProblem } from '../lib/compress'
import { cx, kb } from '../lib/util'
import { Icon } from './Icon'
import { Confirm, Spinner } from './ui'

export interface PhotoItem {
  key: string
  /** 预览地址；noPreview 的问题照片（HEIC 等）可以为空 */
  url: string
  /** 原文件名（不能预览时缩略图上显示） */
  name?: string
  /** 不合格原因：网格里标红，不能上传，可以删 */
  problem?: PhotoProblem | null
  /** 压缩后字节数（显示“✓ 486KB”） */
  size?: number
  /** 原图字节数（读屏和悬停提示里说明压了多少） */
  originalSize?: number
  /** 压缩状态：排队中 / 压缩中（pct 0–100）；没有就是已完成或不需要压缩 */
  status?: 'queued' | 'compressing'
  pct?: number
}

/** 校验选中的文件：返回可用文件 + 中文错误 */
export function checkFiles(files: File[], existing: number): { ok: File[]; errors: string[] } {
  const ok: File[] = []
  const errors: string[] = []
  for (const f of files) {
    if (isHeic(f)) {
      errors.push(heicPhotoText(f.name))
      continue
    }
    if (!(LIMITS.photoTypes as readonly string[]).includes(f.type)) {
      errors.push(`「${f.name}」不是 jpg/png/webp 格式的照片`)
      continue
    }
    if (f.size > LIMITS.photoMaxBytes) {
      errors.push(tooBigPhotoText(f.name, f.size / (1024 * 1024)))
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
              className={cx(
                'photo-tile',
                i === 0 && !p.problem && 'photo-tile--cover',
                dragging && 'is-dragging',
                target && 'is-target',
                p.problem && 'is-bad',
                p.status && 'is-pending',
              )}
              style={dragging ? { transform: `translate(${drag.dx}px, ${drag.dy}px) rotate(-3deg)` } : undefined}
            >
              {p.problem?.noPreview || !p.url ? (
                <div className="photo-file" role="img" aria-label={`第 ${i + 1} 张`} title={`${p.name ?? ''}（无法预览）`}>
                  <span className="photo-file-ext">{extLabel(p.name ?? '')}</span>
                  <span className="photo-file-name">{(p.name ?? '').replace(/\.[^.]+$/, '')}</span>
                </div>
              ) : (
                <img src={p.url} alt={`第 ${i + 1} 张`} draggable={false} />
              )}
              {p.problem && <span className="photo-ef" aria-hidden="true" />}
              {i === 0 && !p.problem && !p.status && <span className="photo-cover-tag">封面</span>}
              <span className="photo-no" aria-hidden="true">
                {i + 1}
              </span>
              {p.status === 'queued' && (
                <span className="photo-pr" aria-label={`第 ${i + 1} 张排队中`}>
                  <Icon name="clock" size={24} />
                  排队中
                </span>
              )}
              {p.status === 'compressing' && (
                <span className="photo-pr" aria-label={`第 ${i + 1} 张压缩中 ${p.pct ?? 0}%`}>
                  <span className="photo-ring" style={{ '--p': `${p.pct ?? 0}%` } as React.CSSProperties}>
                    <b>{p.pct ?? 0}%</b>
                  </span>
                  压缩中
                </span>
              )}
              {p.problem ? (
                <span className="photo-bad">{p.problem.tag}</span>
              ) : (
                !p.status &&
                p.size != null && (
                  <span className="photo-size" title={sizeTitle(p)} aria-label={sizeTitle(p)}>
                    <Icon name="check" size={11} />
                    {kb(p.size)}
                  </span>
                )
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
                disabled={busy || (items.length <= 1 && !p.problem)}
                title={items.length <= 1 && !p.problem ? '至少要留 1 张照片' : '删除'}
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
        <div className="compress-card" role="status">
          <p>
            <Icon name="image" size={18} />
            <b>正在压缩照片</b>
            <span>
              {progress.done}/{progress.total}
            </span>
          </p>
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done} aria-label="照片压缩进度">
            <i style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
          </div>
          <small>压到长边 1600、每张约 500KB，上传更快，也更省照片柜</small>
        </div>
      )}
      <input ref={album} type="file" accept="image/jpeg,image/png,image/webp,.heic,.heif" multiple hidden onChange={pick} />
      <input ref={camera} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden onChange={pick} />
      <p className="field-hint">
        {items.length}/{LIMITS.photosMax} 张 · jpg/png/webp，单张 ≤10MB（上传前自动压缩）· 第一张是封面
        {items.length > 1 && '，按住 ⠿ 拖动或用箭头调整顺序'}
      </p>
      <ProblemList items={items} />
      {error && <PhotoErrors text={error} />}
      <Confirm
        open={askDel !== null}
        title="删掉这张照片？"
        body={
          askDel !== null && items[askDel] ? (
            <div className="del-preview">
              {items[askDel].url && !items[askDel].problem?.noPreview && <img src={items[askDel].url} alt="" />}
              <p>{items[askDel].problem ? '这张有问题、传不上去，删掉后可以换一张。' : '删了就找不回来啦。'}{askDel === 0 && items.length > 1 ? '它是封面，删掉后下一张会自动变成封面。' : '如果删的是封面，下一张会自动变成封面。'}</p>
            </div>
          ) : null
        }
        okText="删除"
        cancelText="再想想"
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

function sizeTitle(p: PhotoItem): string {
  if (p.size == null) return ''
  if (!p.originalSize || p.originalSize <= p.size) return `已压缩到 ${kb(p.size)}`
  return `已压缩：${kb(p.originalSize)} → ${kb(p.size)}（小了 ${Math.round((1 - p.size / p.originalSize) * 100)}%）`
}

/** 网格下方的“第几张 · 怎么办”清单（设计 ①③：2 张及以上加标题“有 N 张照片需要换一下”） */
function ProblemList({ items }: { items: PhotoItem[] }) {
  const bad = items.map((p, i) => [i, p] as const).filter(([, p]) => p.problem)
  if (!bad.length) return null
  return (
    <div className="photo-problems" role="alert">
      {bad.length > 1 && <b className="photo-problems-title">有 {bad.length} 张照片需要换一下</b>}
      <ul>
        {bad.map(([i, p]) => (
          <li key={p.key}>
            <span className="photo-problems-no" aria-label={`第 ${i + 1} 张`}>
              {i + 1}
            </span>
            <span>
              {p.problem!.detail}
              {p.problem!.meta && <em>{p.problem!.meta}</em>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** 照片错误：多条时做成“有 N 张照片需要换一下”的编号清单（错误用“；”分隔） */
function PhotoErrors({ text }: { text: string }) {
  const list = text.split('；').filter(Boolean)
  if (list.length <= 1) {
    return (
      <p className="field-error" role="alert">
        {text}
      </p>
    )
  }
  return (
    <div className="photo-errors" role="alert">
      <b>有 {list.length} 张照片需要换一下</b>
      <ol>
        {list.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ol>
    </div>
  )
}
