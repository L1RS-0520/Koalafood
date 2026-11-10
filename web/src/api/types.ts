// 前端数据类型（snake_case，与接口一致）；字段名/取值常量见 contract.ts
import type { ChefStatus, CreateMode, DishSource } from './contract'
export type { ChefStatus, CreateMode, DishSource } from './contract'

/** 固定分类（大王答复前先按 6 个做，改这里即可） */
export const CATEGORIES = ['家常菜', '汤羹', '主食', '小吃点心', '甜品饮品', '其他'] as const
export type Category = (typeof CATEGORIES)[number]
export const ALL = '全部'

export interface Ingredient {
  name: string
  amount: string
}

export interface Step {
  text: string
  heat: string
  time: string
  /** 漫画格对白（≤12 字），可能没有，前端用 heat/time 兜底 */
  caption?: string
}

export interface RecipeContent {
  ingredients: Ingredient[]
  steps: Step[]
  tips: string[]
  servings: string | null
  total_time: string | null
}

export interface Draft extends RecipeContent {
  chef_message: string | null
}

export interface Photo {
  id: string
  url: string
}

export interface Dish extends RecipeContent {
  id: string
  name: string
  category: string
  note: string | null
  /** 按顺序，第一张为封面 */
  photos: Photo[]
  /** 封面（兼容字段） */
  photo_url: string
  chef_status: ChefStatus
  source: DishSource
  /** 仅 draft 状态非空 */
  draft: Draft | null
  /** 厨驼留言（写不了时说明原因） */
  chef_message: string | null
  /** 最近一次交给厨驼时附带的要求 */
  requested_note: string | null
  chef_requested_at: string | null
  created_at: string
  updated_at: string
}

export interface DishSummary {
  id: string
  name: string
  category: string
  photo_url: string
  photo_count: number
  chef_status: ChefStatus
  source: DishSource
  created_at: string
}

export interface Health {
  ok: boolean
  chef_enabled?: boolean
  chef_pending?: number
  /** 前端 mock 自己加的标记 */
  mock?: boolean
}

export interface Me {
  logged_in: boolean
  email: string | null
  /** = logged_in；前端只看这个决定是否显示写入口 */
  can_edit: boolean
}

export interface Settings {
  chef_enabled: boolean
}

export interface NewDishInput {
  name: string
  category: string
  /** 1–9 张，第一张为封面 */
  photos: File[]
  note?: string
  mode: CreateMode
  /** 仅 manual 时带，可全空 */
  content?: RecipeContent
}

export type DishPatch = Partial<Pick<Dish, 'name' | 'category' | 'note'> & RecipeContent>

export class ApiError extends Error {
  /** VALIDATION / UNAUTHORIZED / CHEF_DISABLED / NOT_FOUND / CONFLICT / BAD_STATE / TOO_LARGE / BAD_TYPE / INTERNAL / NETWORK(前端) */
  code: string
  status: number
  constructor(code: string, message: string, status = 0) {
    super(message)
    this.code = code
    this.status = status
  }
}

export interface Api {
  health(): Promise<Health>
  me(): Promise<Me>
  listDishes(category?: string): Promise<DishSummary[]>
  getDish(id: string): Promise<Dish>
  createDish(input: NewDishInput): Promise<Dish>
  /** 自己写/编辑：作废未处理的厨驼任务，状态 confirmed，source=manual */
  updateDish(id: string, patch: DishPatch): Promise<Dish>
  /** 追加照片（总数 ≤9） */
  addPhotos(id: string, photos: File[]): Promise<Dish>
  /** 删一张（至少留 1 张） */
  deletePhoto(id: string, photoId: string): Promise<Dish>
  /** 调整顺序/封面（ids 为全部照片 id 的新顺序） */
  reorderPhotos(id: string, ids: string[]): Promise<Dish>
  /** 本地模拟登录/退出（线上不存在，返回 false 表示要走 Access） */
  devLogin(): Promise<boolean>
  devLogout(): Promise<boolean>
  deleteDish(id: string): Promise<void>
  /** 让厨驼(重)写 → pending；已有正式内容保留 */
  askChef(id: string, note?: string): Promise<Dish>
  /** 确认草稿（可带修改后的内容）→ confirmed */
  confirmDraft(id: string, content?: RecipeContent): Promise<Dish>
  /** 丢弃草稿 → confirmed（正式内容不变，可能为空） */
  discardDraft(id: string): Promise<Dish>
  getSettings(): Promise<Settings>
  updateSettings(s: Settings): Promise<Settings>
}
