// 步骤格插画：设计组的考拉插画库（切菜/打蛋/翻炒/装盘 4 张）+ 6 个考拉姿势配底色。
// 按步骤关键词匹配，匹配不上就按顺序轮换（不要求每步传照片）。
import chop from '../assets/steps/chop.webp'
import whisk from '../assets/steps/whisk.webp'
import wok from '../assets/steps/wok.webp'
import plate from '../assets/steps/plate.webp'
import type { StepKind } from '../lib/util'
import { cx } from '../lib/util'
import { Koala, type KoalaPose } from './Koala'

const SCENE: Partial<Record<StepKind, string>> = { knife: chop, bowl: whisk, wok, plate }
/** 没有专属插画的步骤：考拉姿势 + 底色（按序轮换） */
const POSES: { pose: KoalaPose; tone: string }[] = [
  { pose: 'spoon', tone: 'yellow' },
  { pose: 'point', tone: 'pink' },
  { pose: 'taste', tone: 'orange' },
  { pose: 'think', tone: 'mint' },
  { pose: 'wave', tone: 'yellow' },
  { pose: 'happy', tone: 'green' },
]

export function StepArt({ kind, index }: { kind: StepKind; index: number }) {
  const src = SCENE[kind]
  if (src) {
    return <img className="step-scene" src={src} alt="" loading="lazy" decoding="async" draggable={false} />
  }
  const p = POSES[index % POSES.length]
  return (
    <span className={cx('step-pose', `step-pose--${p.tone}`)} aria-hidden="true">
      <Koala pose={p.pose} size={96} />
    </span>
  )
}
