// 统一出口：VITE_MOCK=1 时用浏览器内置 mock，否则走真实 /api
import { httpApi } from './http'
import { mockApi } from './mock'
import type { Api } from './types'

export const IS_MOCK = import.meta.env.VITE_MOCK === '1'
export const api: Api = IS_MOCK ? mockApi : httpApi

export * from './types'
export * from './contract'
export { isEmptyContent, splitIngredientLine } from './normalize'
