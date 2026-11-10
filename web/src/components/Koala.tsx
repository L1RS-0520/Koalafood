// 考拉厨师（设计组素材，已去白底）
import wave from '../assets/koala/koala-wave.webp'
import spoon from '../assets/koala/koala-spoon.webp'
import taste from '../assets/koala/koala-taste.webp'
import point from '../assets/koala/koala-point.webp'
import happy from '../assets/koala/koala-happy.webp'
import think from '../assets/koala/koala-think.webp'
import { cx } from '../lib/util'

const SRC = { wave, spoon, taste, point, happy, think }
export type KoalaPose = keyof typeof SRC

export function Koala({ pose, size = 96, className, alt = '' }: { pose: KoalaPose; size?: number; className?: string; alt?: string }) {
  return (
    <img
      className={cx('koala', `koala--${pose}`, className)}
      src={SRC[pose]}
      width={size}
      height={Math.round(size * 1.12)}
      alt={alt}
      draggable={false}
      decoding="async"
    />
  )
}
