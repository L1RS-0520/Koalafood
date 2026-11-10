/**
 * 联调用的「模拟厨驼」（CHEF_MOCK=1 时才启用，默认关）。
 * 不联网，按菜名给出结构正确、内容像样的示例草稿；备注里“加了X/放了X”会体现在食材和步骤里。
 * 菜名含「失败」时返回带 chef_message 的空草稿，方便前端测“厨驼写不了”的界面。
 * 输出同样经过 normalizeDraft(mode=chef)，与真厨驼交稿走同一套校验。
 */
import { normalizeDraft, type RecipeDraft, type Ingredient, type Step } from "./draft.ts";
import type { DraftRequest, RecipeDraftSource } from "./source.ts";

type Raw = { ingredients: Ingredient[]; steps: Step[]; tips: string[]; servings: string; total_time: string };
const S = (text: string, heat = "", time = "", caption = ""): Step => ({ text, heat, time, caption });
const I = (name: string, amount: string): Ingredient => ({ name, amount });

const BOOK: Record<string, Raw> = {
  "番茄炒蛋": {
    servings: "2人份", total_time: "15分钟",
    ingredients: [I("鸡蛋", "3个"), I("番茄", "2个（约300克）"), I("食用油", "25毫升"), I("盐", "3克"), I("白糖", "5克"), I("葱花", "5克")],
    steps: [
      S("番茄顶部划十字，用开水烫 30 秒后剥皮，切成 2 厘米小块", "", "30秒", "脱衣服啦！"),
      S("鸡蛋打入碗中，加 1 克盐，用筷子顺一个方向打散约 30 秒至表面起细泡", "", "30秒", "打散它！"),
      S("热锅倒入 15 毫升油，烧到油面微微冒烟，倒入蛋液，大火静置 10 秒定型后快速划散，炒到八成熟、仍有少许流动时盛出", "大火", "1分钟", "嫩嫩的！"),
      S("锅里再加 10 毫升油，下番茄块中火翻炒约 2 分钟，用铲子压出汁，炒到番茄软烂出红汤", "中火", "2分钟", "出汁啦～"),
      S("加 5 克白糖、2 克盐炒匀，倒回鸡蛋翻炒 20 秒，让蛋裹满番茄汁，撒葱花关火出锅", "中火", "20秒", "合体！"),
    ],
    tips: ["番茄选熟透的更出汁", "鸡蛋别炒太老，八成熟盛出，回锅后刚好"],
  },
  "红烧肉": {
    servings: "3人份", total_time: "90分钟",
    ingredients: [I("五花肉", "500克"), I("冰糖", "30克"), I("生抽", "2汤匙（30毫升）"), I("老抽", "1汤匙（15毫升）"), I("料酒", "2汤匙（30毫升）"), I("姜", "4片"), I("葱", "2根"), I("八角", "2个"), I("热水", "600毫升")],
    steps: [
      S("五花肉切 3 厘米见方的块，冷水下锅，加 1 汤匙料酒和 2 片姜，大火煮开后再煮 3 分钟撇去浮沫，捞出用温水洗净沥干", "大火", "8分钟", "洗个澡～"),
      S("锅里不放油，下肉块中小火煸炒约 6 分钟，炒到四面微黄、逼出少量油脂", "中小火", "6分钟", "滋滋冒油！"),
      S("把肉拨到一边，加入 30 克冰糖，小火慢慢炒到冰糖化开、冒小泡并变成枣红色，立刻翻炒让肉块均匀上色", "小火", "3分钟", "上色！"),
      S("加入剩余料酒、生抽 30 毫升、老抽 15 毫升、姜片、葱段、八角，翻炒 1 分钟炒出香味", "中火", "1分钟", "香迷糊了"),
      S("倒入 600 毫升热水没过肉块，大火烧开后转小火，盖盖炖 60 分钟，中途翻动一次防粘锅", "小火", "60分钟", "慢慢炖～"),
      S("开盖转大火收汁约 5 分钟，不停翻动，汤汁浓稠能挂在肉上时关火", "大火", "5分钟", "亮晶晶！"),
    ],
    tips: ["炒糖色时火一定要小，糖色发苦就前功尽弃", "炖煮一定加热水，加冷水肉会发紧"],
  },
  "紫菜蛋花汤": {
    servings: "2人份", total_time: "10分钟",
    ingredients: [I("紫菜", "5克"), I("鸡蛋", "1个"), I("虾皮", "5克"), I("清水", "600毫升"), I("盐", "2克"), I("香油", "3毫升"), I("葱花", "3克"), I("淀粉", "5克（加15毫升水调匀）")],
    steps: [
      S("紫菜撕成小片，虾皮用清水冲洗一下沥干；鸡蛋打散备用", "", "2分钟", "准备就绪！"),
      S("锅中加 600 毫升清水，大火烧开后放入虾皮煮 1 分钟出鲜味", "大火", "1分钟", "咕嘟咕嘟"),
      S("加入 2 克盐，倒入调好的水淀粉，边倒边搅拌，煮到汤汁微微变稠", "中火", "30秒", "变稠啦"),
      S("转小火，把蛋液从高处细细地绕圈淋入，静置 10 秒等蛋花浮起后再轻轻推动", "小火", "10秒", "开花！"),
      S("放入紫菜搅散，立刻关火，淋 3 毫升香油、撒葱花即可", "关火", "", "开饭！"),
    ],
    tips: ["淋蛋液时火要小、动作要慢，蛋花才又大又嫩", "紫菜最后放，煮久了会发烂"],
  },
};

const TEMPLATE: Record<string, (name: string) => Raw> = {
  "汤羹": (n) => ({
    servings: "2人份", total_time: "40分钟",
    ingredients: [I(n.replace(/汤|羹/g, "") || "主料", "300克"), I("姜", "3片"), I("清水", "1000毫升"), I("盐", "3克"), I("葱花", "5克")],
    steps: [
      S("主料洗净切成 2 厘米左右的块，冷水下锅，大火煮开后焯 2 分钟去浮沫，捞出洗净", "大火", "5分钟", "先洗洗～"),
      S("锅中加 1000 毫升清水和 3 片姜，放入主料，大火烧开", "大火", "5分钟", "下锅！"),
      S("转小火盖盖慢炖 25 分钟，至主料软烂、汤色变浓", "小火", "25分钟", "慢慢熬～"),
      S("加 3 克盐调味，再煮 2 分钟，撒葱花关火", "中火", "2分钟", "好鲜！"),
    ],
    tips: ["炖汤中途别频繁开盖，香味会跑掉"],
  }),
  "甜品饮品": (n) => ({
    servings: "2人份", total_time: "20分钟",
    ingredients: [I(n, "200克"), I("牛奶", "250毫升"), I("白糖", "15克")],
    steps: [
      S("主料洗净切成 1 厘米小丁，留 20 克做装饰", "", "3分钟", "切切切"),
      S("牛奶 250 毫升倒入小锅，小火加热到锅边冒小泡（约 60℃），加 15 克白糖搅拌至溶化", "小火", "3分钟", "甜甜的～"),
      S("放入主料丁，小火煮 2 分钟后关火，盖盖焖 5 分钟让味道融合", "小火", "7分钟", "焖一焖"),
      S("晾到室温后放冰箱冷藏 10 分钟，倒入杯中，铺上装饰用的主料", "", "10分钟", "完成！"),
    ],
    tips: ["牛奶别煮沸，容易起皮溢锅"],
  }),
};
const generic = (n: string): Raw => ({
  servings: "2人份", total_time: "25分钟",
  ingredients: [I(n.slice(0, 4) || "主料", "300克"), I("食用油", "20毫升"), I("蒜", "3瓣"), I("姜", "3片"), I("生抽", "1汤匙（15毫升）"), I("盐", "2克")],
  steps: [
    S("主料洗净，切成约 1 厘米厚的片或块；蒜拍碎、姜切丝", "", "5分钟", "备菜中～"),
    S("热锅倒入 20 毫升油，中火烧到油面出现细纹，放入蒜和姜爆香约 30 秒", "中火", "30秒", "好香！"),
    S("放入主料转大火快速翻炒 3 分钟，炒到边缘微焦、颜色变深", "大火", "3分钟", "翻翻翻！"),
    S("沿锅边淋入 15 毫升生抽，加 2 克盐，翻炒 1 分钟让每块都均匀上色", "大火", "1分钟", "上味啦"),
    S("尝一下咸淡，关火出锅装盘", "关火", "", "开饭！"),
  ],
  tips: ["这是模拟厨驼的通用模板，真实菜谱请等厨驼来写"],
});

/** 从备注里抽“加了X / 放了X / 加X”的食材 */
export function addedFromNote(note?: string | null): string[] {
  if (!note) return [];
  const out: string[] = [];
  for (const m of note.matchAll(/(?:加了|放了|多加|加点|加些|加)([\u4e00-\u9fa5]{1,4}?)(?=[，。,.、；;！!和跟\s]|$)/g)) {
    const w = m[1].replace(/^(一些|一点|点|些)/, "");
    if (w && !out.includes(w)) out.push(w);
  }
  return out;
}

export function mockDraft(input: DraftRequest): RecipeDraft {
  if (input.name.includes("失败")) {
    return { ingredients: [], steps: [], tips: [], servings: null, total_time: null,
      chef_message: "照片有点糊，看不出是什么做法，大王能补一句备注吗？（模拟厨驼）" };
  }
  const base = BOOK[input.name] ?? (TEMPLATE[input.category] ?? generic)(input.name);
  const raw: Raw = structuredClone(base);
  const notes = [input.note, input.requested_note].filter(Boolean).join("；");
  for (const extra of addedFromNote(notes)) {
    if (raw.ingredients.some((x) => x.name.includes(extra))) continue;
    raw.ingredients.push(I(extra, "200克"));
    const at = Math.max(1, raw.steps.length - 2);
    raw.steps.splice(at, 0, S(`按备注加入${extra}：${extra}去皮切 2 厘米块，放入锅中一起中火煮或翻炒约 8 分钟，用筷子能轻松戳透即可`, "中火", "8分钟", `${extra}来啦！`));
  }
  if (raw.steps.length > 12) raw.steps.length = 12;
  if (notes) raw.tips.push(`已按备注「${notes}」调整（模拟厨驼）`);
  const r = normalizeDraft({ ...raw, chef_message: null }, { mode: "chef" });
  if (!r.ok) throw new Error("模拟厨驼草稿未通过校验：" + r.errors.join("；"));
  return r.draft;
}

export const MockChefSource: RecipeDraftSource = {
  id: "mock-chef", async: false,
  generate: async (input) => mockDraft(input),
};
