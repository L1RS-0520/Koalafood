/**
 * 草稿来源抽象。路由和业务只认 RecipeDraft + normalizeDraft，不关心草稿从哪来。
 *
 * 现在唯一的来源是「厨驼」：异步模式——菜品置 pending，厨驼经 /api/chef/* 领取并交稿，
 * 交稿内容过 normalizeDraft 后写库（见 routes/chef.ts）。
 *
 * 以后如果要接同步来源（比如别的生成服务），只需新增一个实现 RecipeDraftSource 的类，
 * 在 generate() 里拿到原始输出后调用 normalizeDraft()，再由调用方写库；不需要改路由和表结构。
 */
import type { RecipeDraft } from "./draft.ts";

export interface DraftRequest { name: string; category: string; note?: string | null; requested_note?: string | null; photoUrl?: string }

export interface RecipeDraftSource {
  readonly id: string;           // 例如 "chef"
  readonly async: boolean;       // true=异步交稿（厨驼），false=同步返回
  generate?(input: DraftRequest): Promise<RecipeDraft>;
}

/** 厨驼：异步来源，没有 generate()，草稿通过交稿接口进入 */
export const ChefSource: RecipeDraftSource = { id: "chef", async: true };
