// 菜谱展示（设计/详情页-访客长图）：考拉旁白 → 食材漫画小格 → 步骤漫画分格 → 小贴士便利贴 → “开饭啦！”
import { useState } from 'react'
import type { Ingredient, RecipeContent, Step } from '../api'
import { cx, stepCaption, stepKind } from '../lib/util'
import { Icon } from './Icon'
import { Koala } from './Koala'
import { StepArt } from './StepArt'

/** 食材 = 漫画小格：白色漫画页里两列略斜切的小格，上名称下用量；点一下划掉（备菜不漏） */
export function IngredientNote({ items }: { items: Ingredient[] }) {
  const [got, setGot] = useState<Set<number>>(new Set())
  if (items.length === 0) {
    return (
      <div className="ing-page ing-page--empty">
        <p>还没写食材</p>
      </div>
    )
  }
  return (
    <div className="ing-page">
      <ul className="ing-grid">
        {items.map((it, i) => {
          const on = got.has(i)
          return (
            <li key={`${it.name}-${i}`}>
              <button
                type="button"
                className={cx('ing-cell', `ing-cell--k${i % 4}`, on && 'on')}
                aria-pressed={on}
                aria-label={`${it.name} ${it.amount || '适量'}${on ? '，已备好' : ''}`}
                onClick={() =>
                  setGot((s) => {
                    const n = new Set(s)
                    if (n.has(i)) n.delete(i)
                    else n.add(i)
                    return n
                  })
                }
              >
                <span className="ing-name">{it.name}</span>
                <span className="ing-amt">{it.amount || '适量'}</span>
                {on && (
                  <span className="ing-ok" aria-hidden="true">
                    <Icon name="check" size={14} />
                  </span>
                )}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** 版式：“宽-窄窄”循环（第 1、4、7… 步通栏，其余两两并排；最后落单的也通栏） */
function panelSpan(i: number, total: number): 'wide' | 'half' {
  if (total <= 2) return 'wide'
  if (i % 3 === 0) return 'wide'
  if (i % 3 === 1 && i === total - 1) return 'wide'
  return 'half'
}

export function ComicPanels({ steps }: { steps: Step[] }) {
  return (
    <ol className="comic">
      {steps.map((s, i) => {
        const span = panelSpan(i, steps.length)
        const caption = stepCaption(s, i, steps.length)
        const fire = /大火|猛火/.test(s.heat)
        return (
          <li
            key={i}
            className={cx('panel', `panel--${span}`, `panel--t${i % 4}`, fire && 'panel--fire')}
            style={{ '--i': i } as React.CSSProperties}
          >
            <div className="panel-art">
              <StepArt kind={stepKind(s.text, i, steps.length)} index={i} />
              <span className="panel-no" aria-label={`第 ${i + 1} 步`}>
                {i + 1}
              </span>
              {caption && <div className="panel-bubble">{caption}</div>}
              {(s.heat || s.time) && (
              <div className="panel-tags">
                {s.heat && (
                  <span className="chip chip--heat">
                    <Icon name="flame" size={14} />
                    {s.heat}
                  </span>
                )}
                {s.time && (
                  <span className="chip chip--time">
                    <Icon name="clock" size={14} />
                    {s.time}
                  </span>
                )}
              </div>
              )}
            </div>
            <p className="panel-text">{s.text}</p>
          </li>
        )
      })}
    </ol>
  )
}

/** “还没写步骤”：可爱的空白漫画格 */
export function EmptyPanels({ text = '还没写步骤', hint, action }: { text?: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="comic comic--empty">
      <div className="panel panel--wide panel--blank">
        <Koala pose="think" size={86} className="blank-koala" />
        <div className="panel-bubble panel-bubble--big">{text}</div>
        {hint && <p className="blank-hint">{hint}</p>}
        {action && <div className="blank-action">{action}</div>}
      </div>
      <div className="panel panel--half panel--blank panel--ghost" aria-hidden="true" />
      <div className="panel panel--half panel--blank panel--ghost" aria-hidden="true" />
    </div>
  )
}

/** 小贴士：微微倾斜的便利贴 */
export function Tips({ tips }: { tips: string[] }) {
  if (!tips.length) return null
  return (
    <section className="sec" aria-labelledby="sec-tips">
      <h2 className="sec-title" id="sec-tips">
        <Icon name="star" size={20} />
        考拉小贴士
      </h2>
      <ul className="tips">
        {tips.map((t, i) => (
          <li key={i} className={cx('sticky', `sticky--k${i % 3}`)}>
            <i aria-hidden="true" />
            {t}
          </li>
        ))}
      </ul>
    </section>
  )
}

/** 结尾一格“开饭啦！” */
export function EndPanel() {
  return (
    <div className="end-panel" aria-hidden="true">
      <Koala pose="happy" size={150} />
      <b>开饭啦！</b>
    </div>
  )
}

const GUIDES = ['先看看要准备什么～', '材料备齐就开工！', '跟着我一步步来～', '今天也要好好吃饭！']

/** 完整内容（考拉旁白 + 食材 + 步骤 + 贴士 + 开饭啦）。emptyAction：全空时空白格里放的按钮 */
export function RecipeBody({
  content,
  name,
  emptyHint,
  emptyAction,
  ending = true,
}: {
  content: RecipeContent
  name?: string
  emptyHint?: string
  emptyAction?: React.ReactNode
  ending?: boolean
}) {
  const hasSteps = content.steps.length > 0
  const guide = GUIDES[(name?.length ?? 0) % GUIDES.length]
  return (
    <>
      {name && (content.ingredients.length > 0 || hasSteps) && (
        <div className="koala-say">
          <Koala pose="wave" size={60} />
          <p className="bubble bubble--left">
            今天做{name}！
            <br />
            {guide}
          </p>
        </div>
      )}
      <section className="sec" aria-labelledby="sec-ing">
        <h2 className="sec-title" id="sec-ing">
          <Icon name="bowl" size={20} />
          食材
          <span className="sec-sfx" aria-hidden="true">
            准备！
          </span>
          {content.ingredients.length > 0 && <span className="sec-count">{content.ingredients.length} 样 · 点一下划掉</span>}
        </h2>
        <IngredientNote items={content.ingredients} />
      </section>
      <section className="sec" aria-labelledby="sec-steps">
        <h2 className="sec-title" id="sec-steps">
          <Icon name="pencil" size={20} />
          步骤
          <span className="sec-sfx sec-sfx--green" aria-hidden="true">
            滋啦！
          </span>
        </h2>
        {hasSteps ? <ComicPanels steps={content.steps} /> : <EmptyPanels hint={emptyHint} action={emptyAction} />}
      </section>
      <Tips tips={content.tips} />
      {ending && hasSteps && <EndPanel />}
    </>
  )
}
