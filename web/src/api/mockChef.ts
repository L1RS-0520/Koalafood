// mock 厨驼：按分类模板 + 备注写一份示例草稿（只在 VITE_MOCK=1 时使用）
import type { Draft, Ingredient, Step } from './types'

const TEMPLATES: Record<string, { ingredients: Ingredient[]; steps: Step[]; tips: string[]; total_time: string }> = {
  家常菜: {
    ingredients: [
      { name: '食用油', amount: '2勺' },
      { name: '蒜', amount: '3瓣' },
      { name: '生抽', amount: '1勺' },
      { name: '盐', amount: '2克' },
    ],
    steps: [
      { text: '主料洗净切成均匀的小块，蒜切末备用', heat: '', time: '5分钟', caption: '备菜开工！' },
      { text: '热锅凉油，下蒜末爆香', heat: '中火', time: '30秒', caption: '好香～' },
      { text: '倒入主料快速翻炒至断生', heat: '大火', time: '3分钟', caption: '颠起来！' },
      { text: '加生抽和盐调味，翻炒均匀', heat: '中火', time: '1分钟', caption: '调个味' },
      { text: '尝一下咸淡，装盘出锅', heat: '', time: '', caption: '开饭啦！' },
    ],
    tips: ['大火快炒更能锁住水分'],
    total_time: '15分钟',
  },
  汤羹: {
    ingredients: [
      { name: '姜', amount: '3片' },
      { name: '葱', amount: '1根' },
      { name: '盐', amount: '适量' },
    ],
    steps: [
      { text: '主料冷水下锅焯水，撇去浮沫后捞出洗净', heat: '大火', time: '3分钟', caption: '先焯水' },
      { text: '砂锅加足量清水，放入主料和姜片', heat: '', time: '', caption: '下锅～' },
      { text: '大火烧开后转小火慢炖', heat: '小火', time: '1小时', caption: '咕嘟咕嘟' },
      { text: '出锅前加盐调味，撒葱花', heat: '', time: '', caption: '喝汤咯！' },
    ],
    tips: ['一次加够水，中途别加冷水'],
    total_time: '70分钟',
  },
  主食: {
    ingredients: [
      { name: '面粉', amount: '300克' },
      { name: '温水', amount: '160毫升' },
      { name: '盐', amount: '2克' },
    ],
    steps: [
      { text: '面粉加盐，分次倒入温水，揉成光滑面团', heat: '', time: '10分钟', caption: '揉揉揉' },
      { text: '盖保鲜膜醒面', heat: '', time: '20分钟', caption: '睡一会儿' },
      { text: '分成小剂子擀开，按菜品做法成型', heat: '', time: '10分钟', caption: '变形！' },
      { text: '平底锅刷薄油，两面煎至金黄', heat: '中小火', time: '6分钟', caption: '金黄酥脆' },
    ],
    tips: ['面团软一点口感更好'],
    total_time: '45分钟',
  },
  小吃点心: {
    ingredients: [
      { name: '食用油', amount: '适量' },
      { name: '盐', amount: '少许' },
      { name: '孜然粉', amount: '1勺' },
    ],
    steps: [
      { text: '主料处理干净，切成方便入口的大小', heat: '', time: '5分钟', caption: '小块小块' },
      { text: '加盐和调料抓匀腌制', heat: '', time: '15分钟', caption: '入味中' },
      { text: '下锅煎炸至表面金黄', heat: '中火', time: '6分钟', caption: '滋滋～' },
      { text: '捞出控油，趁热撒孜然粉', heat: '', time: '', caption: '香迷糊了' },
    ],
    tips: ['趁热吃最香'],
    total_time: '30分钟',
  },
  甜品饮品: {
    ingredients: [
      { name: '牛奶', amount: '250毫升' },
      { name: '白糖', amount: '20克' },
      { name: '吉利丁片', amount: '2片' },
    ],
    steps: [
      { text: '吉利丁片用冷水泡软', heat: '', time: '5分钟', caption: '泡软软' },
      { text: '牛奶加糖小火加热到微微冒热气，关火', heat: '小火', time: '3分钟', caption: '别煮开哦' },
      { text: '放入泡软的吉利丁片搅拌至融化', heat: '', time: '1分钟', caption: '搅一搅' },
      { text: '倒入杯中，冷藏凝固', heat: '', time: '4小时', caption: '冰箱见！' },
    ],
    tips: ['冷藏一晚口感更 Q 弹'],
    total_time: '4小时20分钟',
  },
  其他: {
    ingredients: [
      { name: '盐', amount: '适量' },
      { name: '食用油', amount: '1勺' },
    ],
    steps: [
      { text: '准备好所有食材，洗净切好', heat: '', time: '5分钟', caption: '准备！' },
      { text: '按自己的口味烹饪至熟透', heat: '中火', time: '10分钟', caption: '认真做饭' },
      { text: '调味后装盘', heat: '', time: '', caption: '完成！' },
    ],
    tips: [],
    total_time: '20分钟',
  },
}

/** 从备注里拎出“加了土豆”“放了香菜”这类食材 */
export function extractExtras(note: string): string[] {
  const out: string[] = []
  const re = /(?:加了|放了|加点|加上|加|放)([\u4e00-\u9fa5]{1,4}?)(?=[，。,.、！!和与及\s]|$)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(note))) {
    const w = m[1].replace(/^(一点|一些|点|些)/, '')
    if (w && !['糖', '辣', '盐'].includes(w) && !out.includes(w)) out.push(w)
  }
  return out
}

export function mockDraft(name: string, category: string, note: string, request?: string | null): Draft {
  if (name.includes('失败')) {
    return {
      ingredients: [],
      steps: [],
      tips: [],
      servings: null,
      total_time: null,
      chef_message: '这张照片我实在认不出是什么菜，大王能补一句备注、或者换张清楚点的照片吗？',
    }
  }
  const t = TEMPLATES[category] ?? TEMPLATES['其他']
  const main: Ingredient = { name: name.replace(/(炒|烧|炖|煮|蒸|拌|煎|汤|饼|面|饭)+$/, '') || name, amount: '300克' }
  const extras = extractExtras(`${note} ${request ?? ''}`).map((n) => ({ name: n, amount: '适量' }))
  const steps = t.steps.map((s) => ({ ...s }))
  if (extras.length) {
    steps.splice(2, 0, {
      text: `加入${extras.map((e) => e.name).join('、')}一起翻匀`,
      heat: '中火',
      time: '2分钟',
      caption: '按大王说的加！',
    })
  }
  const tips = [...t.tips]
  if (/少.?糖/.test(note)) tips.push('按大王的口味，糖减半')
  if (/少.?辣|不.?辣/.test(note)) tips.push('辣椒可以不放，按口味来')
  return {
    ingredients: [main, ...extras, ...t.ingredients],
    steps,
    tips,
    servings: '2人份',
    total_time: t.total_time,
    chef_message: request ? `收到！已经按“${request}”改好啦` : null,
  }
}
