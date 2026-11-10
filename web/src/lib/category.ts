// 分类 → 标签色（分类本身在 api/types.ts 的 CATEGORIES 常量）
// 按《视觉方向说明》§2 分类底色：家常菜 #FFE6D6 · 汤羹 #E3F4EC · 主食 #FFF1B8 · 小吃点心 #FFE3C7 · 甜品饮品 #FFD9E0 · 其他 #E8E6F0
export type Tone = 'home' | 'soup' | 'staple' | 'snack' | 'sweet' | 'other'
const MAP: Record<string, Tone> = {
  家常菜: 'home',
  汤羹: 'soup',
  主食: 'staple',
  小吃点心: 'snack',
  甜品饮品: 'sweet',
  其他: 'other',
}
export const categoryTone = (c: string): Tone => MAP[c] ?? 'other'
