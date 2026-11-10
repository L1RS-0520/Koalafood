// 分类 → 标签色（分类本身在 api/types.ts 的 CATEGORIES 常量）
export type Tone = 'green' | 'yellow' | 'orange' | 'pink' | 'gray'
const MAP: Record<string, Tone> = {
  家常菜: 'green',
  汤羹: 'yellow',
  主食: 'orange',
  小吃点心: 'yellow',
  甜品饮品: 'pink',
  其他: 'gray',
}
export const categoryTone = (c: string): Tone => MAP[c] ?? 'gray'
