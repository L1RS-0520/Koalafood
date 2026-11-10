// mock 示例菜（覆盖各状态：已确认/手写/全空/草稿/厨驼写不了/待写/重写中），图片用设计组素材
import tomato from '../assets/mock/tomato.webp'
import soup from '../assets/mock/soup.webp'
import pork from '../assets/mock/pork.webp'
import mango from '../assets/mock/mango.webp'
import skewer from '../assets/mock/skewer.webp'
import bfast from '../assets/mock/bfast.webp'
import noodle from '../assets/mock/noodle.svg'
import plum from '../assets/mock/plum.svg'
import tomato2 from '../assets/mock/tomato-2.webp'
import pork2 from '../assets/mock/pork-2.webp'
import skewer2 from '../assets/mock/skewer-2.webp'
import mango2 from '../assets/mock/mango-2.webp'
import type { ChefStatus, DishSource } from './contract'
import type { Draft, Ingredient, Step } from './types'

export const SEED_PHOTOS: Record<string, string> = {
  tomato,
  'tomato-2': tomato2,
  soup,
  pork,
  'pork-2': pork2,
  mango,
  'mango-2': mango2,
  skewer,
  'skewer-2': skewer2,
  bfast,
  noodle,
  plum,
}

export interface MockPhoto {
  id: string
  /** seed:xxx 或 dataURL */
  ref: string
}
const P = (...names: string[]): MockPhoto[] => names.map((n) => ({ id: `ph-${n}`, ref: `seed:${n}` }))

/** mock 存储里的菜（photo 存 seed:xxx 或 dataURL） */
export interface MockDish {
  id: string
  name: string
  category: string
  note: string | null
  photos: MockPhoto[]
  chef_status: ChefStatus
  source: DishSource
  ingredients: Ingredient[]
  steps: Step[]
  tips: string[]
  servings: string | null
  total_time: string | null
  draft: Draft | null
  requested_note: string | null
  chef_requested_at: string | null
  created_at: string
  updated_at: string
}

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString()
const base = (o: Partial<MockDish> & Pick<MockDish, 'id' | 'name' | 'category' | 'photos'>, minAgo: number): MockDish => ({
  note: null,
  chef_status: 'confirmed',
  source: 'chef',
  ingredients: [],
  steps: [],
  tips: [],
  servings: null,
  total_time: null,
  draft: null,
  requested_note: null,
  chef_requested_at: null,
  created_at: ago(minAgo),
  updated_at: ago(minAgo),
  ...o,
})

export function makeSeed(): MockDish[] {
  return [
    // 待写：刚交给厨驼（mock 里 20 秒后自动出草稿）
    base(
      {
        id: 'seed-mango',
        name: '芒果布丁',
        category: '甜品饮品',
        photos: P('mango', 'mango-2'),
        note: '少放糖，想要 Q 弹一点',
        chef_status: 'pending',
        chef_requested_at: new Date().toISOString(),
      },
      2,
    ),
    // 已出草稿：等大王确认
    base(
      {
        id: 'seed-pork',
        name: '红烧肉',
        category: '家常菜',
        photos: P('pork', 'pork-2'),
        note: '加了鹌鹑蛋',
        chef_status: 'draft',
        chef_requested_at: ago(30),
        draft: {
          ingredients: [
            { name: '五花肉', amount: '500克' },
            { name: '鹌鹑蛋', amount: '10个' },
            { name: '冰糖', amount: '30克' },
            { name: '生抽', amount: '2勺' },
            { name: '老抽', amount: '1勺' },
            { name: '料酒', amount: '2勺' },
            { name: '姜片', amount: '4片' },
            { name: '八角', amount: '2个' },
          ],
          steps: [
            { text: '五花肉切 3 厘米见方的块，冷水下锅，加姜片和料酒焯水 3 分钟，捞出洗净', heat: '大火', time: '3分钟', caption: '先去腥！' },
            { text: '鹌鹑蛋煮 5 分钟，过凉水剥壳备用', heat: '中火', time: '5分钟', caption: '剥剥剥～' },
            { text: '锅里少油，放冰糖小火炒到枣红色冒小泡', heat: '小火', time: '4分钟', caption: '糖色要盯紧' },
            { text: '倒入五花肉快速翻炒，让每块都裹上糖色', heat: '中火', time: '2分钟', caption: '上色啦！' },
            { text: '加生抽、老抽、八角和没过肉的热水，放入鹌鹑蛋，盖盖小火炖 50 分钟', heat: '小火', time: '50分钟', caption: '咕嘟咕嘟' },
            { text: '开盖转大火收汁，汤汁浓稠发亮即可出锅', heat: '大火', time: '5分钟', caption: '亮晶晶！' },
          ],
          tips: ['加热水不要加冷水，肉会发紧', '收汁时要不停翻动，防止糊底'],
          servings: '3人份',
          total_time: '75分钟',
          chef_message: '鹌鹑蛋我放在炖的时候一起进锅，这样更入味～',
        },
      },
      40,
    ),
    // 重写中：已有正式内容 + pending
    base(
      {
        id: 'seed-skewer',
        name: '孜然烤串',
        category: '小吃点心',
        photos: P('skewer', 'skewer-2'),
        note: '用空气炸锅做的',
        chef_status: 'pending',
        source: 'chef',
        requested_note: '改成空气炸锅的做法',
        chef_requested_at: new Date().toISOString(),
        ingredients: [
          { name: '羊肉', amount: '400克' },
          { name: '孜然粒', amount: '2勺' },
          { name: '辣椒面', amount: '1勺' },
          { name: '洋葱', amount: '半个' },
          { name: '盐', amount: '适量' },
        ],
        steps: [
          { text: '羊肉切 2 厘米小块，加洋葱丝、盐抓匀腌 30 分钟', heat: '', time: '30分钟', caption: '腌入味' },
          { text: '用竹签穿好，每串 5–6 块', heat: '', time: '', caption: '串串串！' },
          { text: '烤架刷油，烤 8 分钟，中途翻面', heat: '大火', time: '8分钟', caption: '滋滋～' },
          { text: '撒孜然粒和辣椒面再烤 1 分钟', heat: '大火', time: '1分钟', caption: '香迷糊了' },
        ],
        tips: ['肥瘦相间的肉串更香'],
        servings: '2人份',
        total_time: '45分钟',
      },
      60 * 5,
    ),
    // 厨驼写不了：空草稿 + chef_message
    base(
      {
        id: 'seed-bfast',
        name: '鸡蛋灌饼',
        category: '主食',
        photos: P('bfast'),
        chef_status: 'draft',
        chef_requested_at: ago(60 * 8),
        draft: {
          ingredients: [],
          steps: [],
          tips: [],
          servings: null,
          total_time: null,
          chef_message: '照片里饼卷起来了，我看不清里面夹了什么酱和菜，大王能补一句备注吗？',
        },
      },
      60 * 9,
    ),
    // 已确认（厨驼写的）
    base(
      {
        id: 'seed-tomato',
        name: '番茄炒蛋',
        category: '家常菜',
        photos: P('tomato', 'tomato-2'),
        note: '少放糖',
        source: 'chef',
        ingredients: [
          { name: '鸡蛋', amount: '3个' },
          { name: '番茄', amount: '2个' },
          { name: '葱花', amount: '一小把' },
          { name: '盐', amount: '2克' },
          { name: '白糖', amount: '3克' },
          { name: '食用油', amount: '2勺' },
        ],
        steps: [
          { text: '番茄顶部划十字，开水烫 30 秒后去皮，切成小块', heat: '', time: '30秒', caption: '去皮更顺滑' },
          { text: '鸡蛋打入碗中，加 1 克盐，用筷子打散约 30 秒至起泡', heat: '', time: '30秒', caption: '打打打！' },
          { text: '热锅下 1 勺油，倒入蛋液，凝固后用铲子推散，七成熟盛出', heat: '中火', time: '1分钟', caption: '别炒老了' },
          { text: '锅里再下 1 勺油，放番茄块翻炒出汁，加 1 克盐和 3 克糖', heat: '中火', time: '2分钟', caption: '出汁啦～' },
          { text: '倒回鸡蛋翻炒均匀，撒葱花出锅', heat: '大火', time: '30秒', caption: '开饭！' },
        ],
        tips: ['番茄选熟透的更出汁', '鸡蛋七成熟就盛出，回锅后刚刚好'],
        servings: '2人份',
        total_time: '15分钟',
      },
      60 * 24,
    ),
    // 已确认（手写，步骤没有 caption/heat，测试前端兜底）
    base(
      {
        id: 'seed-soup',
        name: '玉米排骨汤',
        category: '汤羹',
        photos: P('soup'),
        note: '妈妈的做法',
        source: 'manual',
        ingredients: [
          { name: '排骨', amount: '500克' },
          { name: '甜玉米', amount: '2根' },
          { name: '胡萝卜', amount: '1根' },
          { name: '姜', amount: '3片' },
          { name: '盐', amount: '' },
        ],
        steps: [
          { text: '排骨冷水下锅焯水，撇去浮沫后捞出', heat: '', time: '' },
          { text: '玉米切段，胡萝卜切滚刀块', heat: '', time: '' },
          { text: '所有材料放进砂锅，加足量清水和姜片', heat: '', time: '' },
          { text: '大火烧开后转小火炖 1 小时', heat: '小火', time: '1小时' },
          { text: '出锅前加盐调味', heat: '', time: '' },
        ],
        tips: [],
        servings: '4人份',
        total_time: '80分钟',
      },
      60 * 48,
    ),
    // 已确认（手写，全空：只记了一句备注）
    base(
      {
        id: 'seed-noodle',
        name: '葱油拌面',
        category: '主食',
        photos: P('noodle'),
        note: '葱要炸到焦黄才香，下次记得多做点葱油',
        source: 'manual',
      },
      60 * 72,
    ),
    // 已确认（手写，只有食材）
    base(
      {
        id: 'seed-plum',
        name: '冰镇酸梅汤',
        category: '甜品饮品',
        photos: P('plum'),
        source: 'manual',
        ingredients: [
          { name: '乌梅', amount: '30克' },
          { name: '山楂干', amount: '20克' },
          { name: '陈皮', amount: '5克' },
          { name: '冰糖', amount: '适量' },
        ],
      },
      60 * 96,
    ),
  ]
}
