/**
 * 菜谱草稿：统一类型 + 统一清洗/校验/规范化。
 * 任何草稿来源（现在只有厨驼交稿接口）都必须先过 normalizeDraft()，再写库。
 * 本文件不依赖 Worker 运行时，可在 Node 里直接 import（Node ≥22 类型剥离）。
 */

export interface Ingredient { name: string; amount: string }
export interface Step { text: string; heat: string; time: string; caption: string }
export interface RecipeDraft {
  ingredients: Ingredient[];
  steps: Step[];
  tips: string[];
  servings: string | null;
  total_time: string | null;
  /** 厨驼写不了时给大王的话（如“照片看不清”）；正式内容里不存 */
  chef_message?: string | null;
}

export type NormalizeResult =
  | { ok: true; draft: RecipeDraft; warnings: string[] }
  | { ok: false; errors: string[] };

export interface NormalizeOptions {
  /**
   * chef：厨驼交稿，严格——食材 ≥1 项、步骤 3–12 步；
   *       仅当带了非空 chef_message 且食材、步骤都是空数组时，允许空稿。
   * edit：大王手写/编辑/确认时修改，宽松——允许全空，步骤最多 30 步。
   */
  mode?: "chef" | "edit";
}

export const LIMITS = {
  ingredientsMax: 40,
  ingredientName: 20,
  ingredientAmount: 20,
  chefStepsMin: 3,
  chefStepsMax: 12,
  editStepsMax: 30,
  chefMessage: 200,
  stepText: 300,
  heat: 8,
  time: 12,
  caption: 12,
  tipsMax: 10,
  tip: 120,
  servings: 20,
  totalTime: 20,
} as const;

const len = (s: string) => Array.from(s).length;
const cut = (s: string, n: number) => Array.from(s).slice(0, n).join("");

/** 把字符串形式的草稿解析成对象：剥 ```json 围栏、截取首个完整 {…} */
export function parseDraftText(text: string): unknown {
  let t = text.trim().replace(/^\uFEFF/, "");
  const fence = t.match(/```(?:json|JSON)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  try { return JSON.parse(t); } catch { /* 继续截取 */ }
  const start = t.indexOf("{");
  if (start < 0) throw new Error("找不到 JSON 对象（缺少 { ）");
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < t.length; i++) {
    const ch = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      try { return JSON.parse(t.slice(start, i + 1)); }
      catch (e) { throw new Error("JSON 格式错误：" + (e as Error).message); }
    }
  }
  throw new Error("JSON 不完整（大括号没有闭合）");
}

const str = (v: unknown): string | null => {
  if (typeof v === "string") return v.replace(/\s+/g, " ").trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
};

/** 去掉步骤开头的编号，如 “1.” “第一步：” “Step 2:” */
const stripNumbering = (s: string) =>
  s.replace(/^(?:第[一二三四五六七八九十\d]+步[:：、.\s]*|步骤\s*\d+[:：、.\s]*|step\s*\d+[:：.\s]*|\d+\s*[.、:：)）]\s*)/i, "").trim();

const HEAT_ALIASES: Record<string, string> = {
  "大火": "大火", "旺火": "大火", "猛火": "大火", "武火": "大火",
  "中大火": "中大火", "中火": "中火", "中小火": "中小火",
  "小火": "小火", "文火": "小火", "微火": "微火", "关火": "关火", "无": "",
};

function normHeat(v: unknown): string {
  const s = str(v) ?? "";
  if (!s) return "";
  if (s in HEAT_ALIASES) return HEAT_ALIASES[s];
  return cut(s, LIMITS.heat);
}

function fieldOf(o: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k];
  return undefined;
}

/**
 * 统一清洗 + 严格结构校验 + 规范化。
 * - input 可以是对象，也可以是字符串（会先 parseDraftText）。
 * - 会截断：caption ≤12 字、heat ≤8、time ≤12 等；截断记为 warnings。
 * - 结构错误（类型不对、缺必填项、步骤数越界）记为 errors，返回 ok:false，中文说明。
 */
export function normalizeDraft(input: unknown, opts: NormalizeOptions = {}): NormalizeResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let obj: unknown = input;
  if (typeof input === "string") {
    try { obj = parseDraftText(input); }
    catch (e) { return { ok: false, errors: [(e as Error).message] }; }
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    return { ok: false, errors: ["草稿必须是一个 JSON 对象，例如 {\"ingredients\":[...],\"steps\":[...]}"] };
  }
  const o = obj as Record<string, unknown>;
  const mode = opts.mode ?? "edit";
  const stepsMax = mode === "chef" ? LIMITS.chefStepsMax : LIMITS.editStepsMax;

  // ---- 厨驼留言 ----
  let chef_message: string | null = null;
  if (o.chef_message !== undefined && o.chef_message !== null) {
    const m = str(o.chef_message);
    if (m === null) errors.push("chef_message 必须是字符串");
    else if (m) chef_message = len(m) > LIMITS.chefMessage ? cut(m, LIMITS.chefMessage) : m;
  }

  // ---- 食材 ----
  const ingredients: Ingredient[] = [];
  const rawIng = o.ingredients ?? [];
  if (!Array.isArray(rawIng)) errors.push("ingredients 必须是数组");
  else {
    if (rawIng.length > LIMITS.ingredientsMax) errors.push(`食材最多 ${LIMITS.ingredientsMax} 项，现在有 ${rawIng.length} 项`);
    rawIng.slice(0, LIMITS.ingredientsMax).forEach((it, i) => {
      let name: string | null = null, amount: string | null = "";
      if (typeof it === "string") {
        // 兼容 “鸡蛋 3个” / “鸡蛋：3个”
        const m = it.trim().match(/^(.+?)[\s:：]+(.+)$/);
        if (m) { name = m[1].trim(); amount = m[2].trim(); } else name = it.trim();
      } else if (it && typeof it === "object") {
        const r = it as Record<string, unknown>;
        name = str(fieldOf(r, ["name", "名称", "食材"]));
        amount = str(fieldOf(r, ["amount", "quantity", "用量"])) ?? "";
      }
      if (!name) { errors.push(`第 ${i + 1} 项食材缺少 name（食材名）`); return; }
      if (len(name) > LIMITS.ingredientName) { warnings.push(`第 ${i + 1} 项食材名过长，已截断`); name = cut(name, LIMITS.ingredientName); }
      if (len(amount) > LIMITS.ingredientAmount) { warnings.push(`第 ${i + 1} 项食材用量过长，已截断`); amount = cut(amount, LIMITS.ingredientAmount); }
      ingredients.push({ name, amount });
    });
  }

  // ---- 步骤 ----
  const steps: Step[] = [];
  const rawSteps = o.steps ?? [];
  if (!Array.isArray(rawSteps)) errors.push("steps 必须是数组");
  else {
    if (rawSteps.length > stepsMax) errors.push(`步骤最多 ${stepsMax} 步，现在有 ${rawSteps.length} 步`);
    rawSteps.slice(0, stepsMax).forEach((it, i) => {
      let text: string | null = null, heat = "", time = "", caption = "";
      if (typeof it === "string") text = it;
      else if (it && typeof it === "object") {
        const r = it as Record<string, unknown>;
        text = str(fieldOf(r, ["text", "step", "description", "内容"]));
        heat = normHeat(fieldOf(r, ["heat", "火候"]));
        time = str(fieldOf(r, ["time", "时间"])) ?? "";
        caption = str(fieldOf(r, ["caption", "对白"])) ?? "";
      }
      text = text ? stripNumbering(text.replace(/\s+/g, " ").trim()) : null;
      if (!text) { errors.push(`第 ${i + 1} 步缺少 text（步骤内容）`); return; }
      if (len(text) > LIMITS.stepText) errors.push(`第 ${i + 1} 步太长（${len(text)} 字，最多 ${LIMITS.stepText} 字），请拆成两步`);
      if (len(time) > LIMITS.time) { warnings.push(`第 ${i + 1} 步 time 过长，已截断`); time = cut(time, LIMITS.time); }
      if (len(caption) > LIMITS.caption) { warnings.push(`第 ${i + 1} 步 caption 超过 ${LIMITS.caption} 字，已截断`); caption = cut(caption, LIMITS.caption); }
      steps.push({ text, heat, time, caption });
    });
  }
  if (mode === "chef" && Array.isArray(rawIng) && Array.isArray(rawSteps)) {
    const emptyWithMessage = chef_message && rawIng.length === 0 && rawSteps.length === 0;
    if (!emptyWithMessage) {
      if (rawIng.length === 0) errors.push("食材不能为空，至少写 1 项（实在写不了请只交 chef_message，食材和步骤都给空数组）");
      if (rawSteps.length < LIMITS.chefStepsMin)
        errors.push(`步骤要 ${LIMITS.chefStepsMin}–${LIMITS.chefStepsMax} 步，现在只有 ${rawSteps.length} 步`);
    }
  }

  // ---- 小贴士 ----
  const tips: string[] = [];
  const rawTips = o.tips ?? [];
  if (typeof rawTips === "string") { if (rawTips.trim()) tips.push(cut(rawTips.trim(), LIMITS.tip)); }
  else if (!Array.isArray(rawTips)) errors.push("tips 必须是字符串数组");
  else {
    if (rawTips.length > LIMITS.tipsMax) warnings.push(`小贴士最多 ${LIMITS.tipsMax} 条，多余的已丢弃`);
    for (const t of rawTips.slice(0, LIMITS.tipsMax)) {
      const s = str(t);
      if (s === null) { errors.push("tips 里每一项都必须是字符串"); break; }
      if (s) tips.push(len(s) > LIMITS.tip ? cut(s, LIMITS.tip) : s);
    }
  }

  // ---- 份量/总时长 ----
  const optText = (key: "servings" | "total_time", max: number, unit: string): string | null => {
    const v = o[key];
    if (v === undefined || v === null || v === "") return null;
    const s = typeof v === "number" ? `${v}${unit}` : str(v);
    if (s === null) { errors.push(`${key} 必须是字符串，例如 "2${unit}"`); return null; }
    return s ? cut(s, max) : null;
  };
  const servings = optText("servings", LIMITS.servings, "人份");
  const total_time = optText("total_time", LIMITS.totalTime, "分钟");

  if (errors.length) return { ok: false, errors };
  const draft: RecipeDraft = { ingredients, steps, tips, servings, total_time };
  if (mode === "chef") draft.chef_message = chef_message;
  return { ok: true, draft, warnings };
}
