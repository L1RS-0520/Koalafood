// ⚠️ 接口字段名与取值集中在这里（后端可能还会微调，只改这个文件）
// 依据：app/docs/接口约定.md 开头的「v2.3.2 当前有效版」（后端审查 P2-3）

/** 菜品状态字段名（后端 DishSummary / Dish 上） */
export const STATUS_FIELD = 'chef_status'
/** 兼容读取的旧字段名（v2 草案曾用 recipe_status，D1 表里叫 status）。后端现在只返回 chef_status，只为兼容旧 mock 数据保留 */
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

/** 旧取值 → 新取值（兼容 v2 草案）。后端只会返回 pending/draft/confirmed，其余只为兼容旧 mock 数据保留 */
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
  /** 照片柜用量（仅大王；访客 401） */
  storage: w('/storage'),
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
  /** 份量 / 总时长最多 20 个字（按字符数；后端超过返回 400 VALIDATION，v2.3.3） */
  servingsMax: 20,
  totalTimeMax: 20,
} as const

/** 照片柜用量（GET /api/kitchen/storage）：档位直接用后端的 capacity.level */
export const STORAGE = {
  /** 当天写入次数提醒阈值（daily_ops.used / limit） */
  opsWarnPct: 80,
  /** mock 估算“还能传几张”：每张 500KB（512000 字节） */
  estPhotoBytes: 512_000,
  /** 后端没给 limit_bytes 时的默认值（950MB） */
  defaultLimit: 996_147_200,
} as const

/** 存储提示文案（需求 v2.4.4 §12-24 + 设计 2026-11-10-存储与限额状态） */
export const STORAGE_TEXT = {
  warn: '照片柜已经用了 80%，可以删掉一些旧照片啦',
  danger: '照片柜快满啦（已用 95%），赶紧删掉一些旧照片吧',
  hint: '在菜品编辑页可以删掉不要的照片',
  /** 429 副文案 · 编辑页（产品审核 round-1 第三节 ②） */
  quotaHint: '已填写的内容都还在，不用重填；不加新照片的修改照常可以保存',
  /** 429 副文案 · 上传页（新菜一定带照片，不说“不加新照片照常保存”） */
  quotaHintUpload: '已填写的内容都还在，不用重填，明天直接点上传就行',
  /** 507 弹框正文（只有一个「知道了」） */
  fullBody: '这次填的内容都还在，删掉一些不要的照片后，再点保存就行。',
} as const

/**
 * 选图时逐张校验的提示（产品审核 round-1 第三节 ② 定稿）。
 * PhotoManager 选图校验、compress 解码失败、round-2-photos 网格标红都直接引用这两个函数，保证一字不差。
 */
/** HEIC：「文件名」是 HEIC 格式，请换成 JPG/PNG（iPhone 可在 设置-相机-格式 选‘兼容性最佳’） */
export function heicPhotoText(fileName: string): string {
  return `「${fileName}」是 HEIC 格式，请换成 JPG/PNG（iPhone 可在 设置-相机-格式 选‘兼容性最佳’）`
}
/** MB 数保留 1 位小数、向上取整（需求 v2.4.6 §12-33 第 3 条：10,485,761 字节 → 10.1，不能显示 10.0）。先去掉浮点误差再进位 */
export function ceilMb1(mb: number): string {
  return (Math.ceil(Math.round(mb * 10 * 1e6) / 1e6) / 10).toFixed(1)
}
/** 原图超 10MB：「文件名」有 X MB，超过 10MB 了，换一张小一点的吧（mb 为 MB 数，1 位小数向上取整） */
export function tooBigPhotoText(fileName: string, mb: number): string {
  return `「${fileName}」有 ${ceilMb1(mb)} MB，超过 10MB 了，换一张小一点的吧`
}
const MB_BYTES = 1024 * 1024
/** 旧调用方式（按字节）的兼容封装 */
export const PHOTO_TEXT = {
  heic: heicPhotoText,
  tooBig: (fileName: string, bytes: number) => tooBigPhotoText(fileName, bytes / MB_BYTES),
} as const

/** 文件是不是 HEIC/HEIF（按 MIME 或扩展名） */
export const isHeic = (f: { type: string; name: string }) => /heic|heif/i.test(f.type) || /\.(heic|heif)$/i.test(f.name)

/** 照片存储相关错误码 → 固定文案（不显示后端 message） */
export const STORAGE_ERROR_TEXT: Record<string, string> = {
  STORAGE_QUOTA: '今天食堂的照片柜塞满啦，明天再来传吧～',
  STORAGE_FULL: '照片柜满啦，删掉一些旧照片才能继续上传～',
}


/** 确认草稿（直接确认 / 修改后确认）之后的顶部提示（设计 §5.7，产品审核 P2-4） */
export const CONFIRMED_TEXT = '已确认，菜谱上线啦！'
