// 小工具：稳定随机、时间、漫画对白兜底、步骤图标
import type { Step } from '../api'

/** 字符串 → 稳定的 0..1 随机数（同一道菜每次倾斜角度一样） */
export function seeded(s: string, salt = 0): number {
  let h = 2166136261 ^ salt
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 10000) / 10000
}

/** 卡片倾斜角度：-1.6° ~ 1.6°，避开接近 0 的值显得更“贴纸” */
export function tilt(id: string, max = 1.6): number {
  const r = seeded(id) * 2 - 1
  const v = Math.sign(r || 1) * (0.5 + Math.abs(r) * (max - 0.5))
  return Math.round(v * 10) / 10
}

/** “今天 / 昨天 / 3 天前 / 11月2日” */
export function relDate(iso: string): string {
  const t = Date.parse(iso)
  if (!t) return ''
  const d = new Date(t)
  const today = new Date()
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((startOf(today) - startOf(d)) / 86400000)
  if (days <= 0) return '今天'
  if (days === 1) return '昨天'
  if (days < 7) return `${days} 天前`
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

const COMMON_LINES = ['开工！', '嗯哼～', '就是这样！', '稳住～', '看我的！', '快好啦！']

/** 漫画格对白：有 caption 用 caption，否则用 heat/time 兜底 */
export function stepCaption(step: Step, index: number, total: number): string {
  if (step.caption) return step.caption
  if (index === total - 1 && total > 1) return /出锅|装盘|完成|即可|调味/.test(step.text) ? '出锅！' : '大功告成！'
  if (/大火/.test(step.heat)) return '大火走起！'
  if (/小火|文火/.test(step.heat)) return '慢慢来～'
  if (step.time) return `等 ${step.time}～`
  if (index === 0) return '开工！'
  return COMMON_LINES[index % COMMON_LINES.length]
}

export type StepKind = 'knife' | 'wok' | 'pot' | 'bowl' | 'steam' | 'oven' | 'plate' | 'fridge' | 'spark'

/** 按步骤文字猜一个小插图 */
export function stepKind(text: string, index: number, total: number): StepKind {
  if (/冷藏|冰箱|冷冻/.test(text)) return 'fridge'
  if (/蒸/.test(text)) return 'steam'
  if (/烤|空气炸锅|烤箱/.test(text)) return 'oven'
  if (/出锅|装盘|盛盘|摆盘/.test(text)) return 'plate'
  if (/炖|煮|焯|汤|烧开|砂锅/.test(text)) return 'pot'
  if (/炒|煎|炸|爆香|下锅|翻|油/.test(text)) return 'wok'
  if (/切|剁|拍|片|丝|丁|块/.test(text)) return 'knife'
  if (/打散|搅|拌|腌|揉|泡|调/.test(text)) return 'bowl'
  if (/装盘|出锅|盛|撒/.test(text) || index === total - 1) return 'plate'
  return 'spark'
}

/** 卡片封面小气泡（≤5 字），按分类挑，约四成卡片显示 */
const BUBBLES: Record<string, string[]> = {
  家常菜: ['超下饭！', '香！', '再来一碗'],
  汤羹: ['暖暖的～', '咕嘟～'],
  主食: ['管饱！', '香喷喷'],
  小吃点心: ['滋滋～', '嘎嘣脆'],
  甜品饮品: ['甜滋滋', 'Q弹～'],
  其他: ['好吃！'],
}
export function coverBubble(id: string, category: string): string | null {
  if (seeded(id, 7) > 0.45) return null
  const list = BUBBLES[category] ?? BUBBLES['其他']
  return list[Math.floor(seeded(id, 3) * list.length)]
}

/** 字符数（按 Unicode 码点，emoji 算 1） */
export const len = (s: string) => [...s].length

export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))}KB`
  return `${(n / 1024 / 1024).toFixed(1)}MB`
}

export function cx(...xs: (string | false | null | undefined)[]): string {
  return xs.filter(Boolean).join(' ')
}

/** “2026-11-09” 形式的日期（本地时区） */
export function dateLabel(iso: string): string {
  const d = new Date(iso)
  if (isNaN(+d)) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** 1,030KB 形式（1024 进制，向上取整，千分位） */
export function kb(n: number): string {
  return `${Math.ceil(n / 1024).toLocaleString('en-US')}KB`
}
/** 413 TOO_LARGE 文案（需求 v2.4.4）：照片太大了（1,030KB），上限 1,024KB */
export function tooLargeText(size?: number | null): string {
  // 只有确实超过 1MB 才写出大小（避免出现“3KB 太大”这种自相矛盾的话）
  return size && size > 1_048_576 ? `照片太大了（${kb(size)}），上限 1,024KB` : '照片太大了，上限 1,024KB'
}
/** 从后端 message 里取“第 N 张”（1 起） */
export function photoIndexOf(message: string): number | null {
  const m = /第\s*(\d+)\s*张/.exec(message)
  return m ? Number(m[1]) : null
}
