// 厨驼：戴厨师帽的小羊驼（考拉的搭档），用设计组 4 帧素材；
// 写作动画按《视觉方向说明》5.8：看照片 1.2s → 想一想 1.2s → 奋笔疾书 1.6s 循环，帧间交叉淡入 150ms；
// prefers-reduced-motion 时只显示静态「奋笔疾书」帧。
import { useEffect, useState } from 'react'
import write from '../assets/llama/llama-write.webp'
import look from '../assets/llama/llama-look.webp'
import think from '../assets/llama/llama-think.webp'
import done from '../assets/llama/llama-done.webp'
import { cx } from '../lib/util'

const SRC = { write, look, think, done }
export type LlamaPose = keyof typeof SRC | 'off'

/** 单帧厨驼。off = 下班（灰色写字帧） */
export function ChefLlama({
  pose = 'write',
  size = 120,
  animated = false,
  className,
  title = '厨驼',
}: {
  pose?: LlamaPose
  size?: number
  animated?: boolean
  className?: string
  title?: string
}) {
  const src = pose === 'off' ? write : SRC[pose]
  return (
    <img
      className={cx('llama', `llama--${pose}`, animated && 'llama--wiggle', className)}
      src={src}
      alt={title}
      width={size}
      height={Math.round(size * 1.2)}
      style={{ width: size, height: 'auto' }}
      draggable={false}
      decoding="async"
    />
  )
}

const FRAMES = [
  { pose: 'look' as const, ms: 1200, sub: '正在看大王的照片…' },
  { pose: 'think' as const, ms: 1200, sub: '在想放多少盐…' },
  { pose: 'write' as const, ms: 1600, sub: '奋笔疾书中…' },
]

function useReducedMotion() {
  const [r, setR] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return
    const m = matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setR(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return r
}

/** 写作动画舞台：返回当前帧副标题，供外面显示 */
export function ChefWriting({ size = 120, onSub }: { size?: number; onSub?: (s: string) => void }) {
  const reduced = useReducedMotion()
  const [i, setI] = useState(reduced ? 2 : 0)
  useEffect(() => {
    if (reduced) {
      setI(2)
      return
    }
    const t = setTimeout(() => setI((x) => (x + 1) % FRAMES.length), FRAMES[i].ms)
    return () => clearTimeout(t)
  }, [i, reduced])
  useEffect(() => onSub?.(FRAMES[i].sub), [i, onSub])
  return (
    <span className="llama-stage" style={{ width: size, height: Math.round(size * 1.25) }} role="img" aria-label="厨驼正在写菜谱">
      {FRAMES.map((f, k) => (
        <img key={f.pose} src={SRC[f.pose]} alt="" className={cx('llama-frame', k === i && 'on')} draggable={false} />
      ))}
    </span>
  )
}

/** 标题后面轮转的三个点 */
export function Dots() {
  return (
    <span className="dots" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  )
}
