// ⚠️ 接口字段名与取值集中在这里（后端可能还会微调，只改这个文件）
// 依据：app/docs/接口约定.md 末尾「v2.1 最终定稿」（唯一准绳）+ 需求文档 v2.0 第 4 节

/** 菜品状态字段名（后端 DishSummary / Dish 上） */
export const STATUS_FIELD = 'chef_status'
/** 兼容读取的旧字段名（v2 草案曾用 recipe_status，D1 表里叫 status） */
export const STATUS_FIELD_FALLBACKS = ['recipe_status', 'status'] as const

/** 菜品状态取值 */
export const CHEF_STATUS = {
  /** 待写：等厨驼写（含“重写中”：已有正式内容 + 等新草稿） */
  pending: 'pending',
  /** 已出草稿：等大王确认（厨驼写不了时也是 draft，带 chef_message） */
  draft: 'draft',
  /** 已确认：正式菜谱 */
  confirmed: 'confirmed',
} as const
export type ChefStatus = (typeof CHEF_STATUS)[keyof typeof CHEF_STATUS]

/** 旧取值 → 新取值（兼容 v2 草案） */
export const STATUS_ALIASES: Record<string, ChefStatus> = {
  pending: 'pending',
  waiting: 'pending',
  draft: 'draft',
  drafted: 'draft',
  failed: 'draft',
  confirmed: 'confirmed',
  done: 'confirmed',
  none: 'confirmed',
}

/** 正式内容来源 */
export const SOURCE = { chef: 'chef', manual: 'manual' } as const
export type DishSource = (typeof SOURCE)[keyof typeof SOURCE]

/** 上传写法（POST /api/dishes 的 mode 字段） */
export const CREATE_MODE = { chef: 'chef', manual: 'manual' } as const
export type CreateMode = (typeof CREATE_MODE)[keyof typeof CREATE_MODE]

/** 设置字段 */
export const SETTINGS_FIELD = 'chef_enabled'

/**
 * 写入接口前缀（相对 /api）。v2.3：写入全部挂 /api/kitchen/*（上线 Access 只保护 /kitchen/* 与 /api/kitchen/*）。
 * 后端若再调整，只改这里。
 */
export const WRITE_PREFIX = '/kitchen'

/** 接口路径（相对 /api） */
const d = (id: string) => `/dishes/${encodeURIComponent(id)}`
const w = (p: string) => `${WRITE_PREFIX}${p}`
export const PATHS = {
  // —— 公开读 ——
  health: '/health',
  me: '/me',
  settings: '/settings',
  dishes: '/dishes',
  dish: d,
  // —— 大王写（需登录）——
  createDish: w('/dishes'),
  updateDish: (id: string) => w(d(id)),
  deleteDish: (id: string) => w(d(id)),
  addPhotos: (id: string) => w(`${d(id)}/photos`),
  deletePhoto: (id: string, photoId: string) => w(`${d(id)}/photos/${encodeURIComponent(photoId)}`),
  photoOrder: (id: string) => w(`${d(id)}/photos/order`),
  askChef: (id: string) => w(`${d(id)}/ask-chef`),
  confirm: (id: string) => w(`${d(id)}/confirm`),
  discardDraft: (id: string) => w(`${d(id)}/discard-draft`),
  updateSettings: w('/settings'),
  // —— 本地开发模拟登录（worker .dev.vars 里 DEV_AUTH=1 才有，否则 404）——
  devLogin: '/dev/login',
  devLogout: '/dev/logout',
} as const

/** multipart 里照片字段名（可重复） */
export const PHOTO_FIELD = 'photos'

/**
 * 线上“大王登录”：整页跳到前端后厨路由 /kitchen/login（Access 保护 /kitchen/*，会先弹登录），
 * 登录回来后该页再跳回 next。本地先试 /api/dev/login，404 时才走这里。
 */
export const KITCHEN_LOGIN_ROUTE = '/kitchen/login'

/** 有 pending 的菜时轮询间隔（需求 ≤15 秒） */
export const POLL_MS = 10_000

/** 上传限制 */
export const LIMITS = {
  nameMax: 30,
  noteMax: 200,
  /** 原图上限（需求：单张 ≤10MB） */
  photoMaxBytes: 10 * 1024 * 1024,
  /** 允许选的原图格式（HEIC 选图时就提示换格式） */
  photoTypes: ['image/jpeg', 'image/png', 'image/webp'],
  /** 压缩后单张上限（后端 >1MB 返回 413 TOO_LARGE） */
  uploadMaxBytes: 1024 * 1024,
  photosMax: 9,
  captionMax: 12,
} as const
