// 菜谱展示：食材便签清单 → 步骤漫画分格 → 小贴士旁白框
import { useState } from 'react'
import type { Ingredient, RecipeContent, Step } from '../api'
import { cx, stepCaption, stepKind } from '../lib/util'
import { Icon } from './Icon'
import { Koala } from './Koala'
import { StepArt } from './StepArt'

export function IngredientNote({ items }: { items: Ingredient[] }) {
  const [got, setGot] = useState<Set<number>>(new Set())
  if (items.length === 0) {
    return (
      <div className="note-paper note-paper--empty">
        <span className="tape tape--c" aria-hidden="true" />
        <p>还没写食材</p>
      </div>
    )
  }
  return (
    <div className="note-paper">
      <span className="tape tape--c" aria-hidden="true" />
      <ul className="ing-list">
        {items.map((it, i) => {
          const on = got.has(i)
          return (
            <li key={`${it.name}-${i}`}>
              <button
                type="button"
                className={cx('ing', on && 'ing--on')}
                aria-pressed={on}
                onClick={() =>
                  setGot((s) => {
                    const n = new Set(s)
                    if (n.has(i)) n.delete(i)
                    else n.add(i)
                    return n
                  })
                }
              >
                <span className="ing-box" aria-hidden="true">
                  {on && <Icon name="check" size={16} />}
                </span>
                <span className="ing-name">{it.name}</span>
                <span className="ing-dots" aria-hidden="true" />
                <span className="ing-amt">{it.amount || '适量'}</span>
              </button>
            </li>
          )
        })}
      </ul>
      <p className="note-hint">点一下打勾，备菜不漏～</p>
    </div>
  )
}

/** 每格的版式：每 3 格里有 1 格通栏，形成错落的漫画页 */
function panelSpan(i: number, total: number): 'wide' | 'half' {
  if (total <= 2) return 'wide'
  if (i % 3 === 0) return 'wide'
  // 最后一格若落单，也通栏
  const posInRow = (i % 3) - 1 // 0 或 1
  if (posInRow === 0 && i === total - 1) return 'wide'
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
            <span className="panel-no" aria-label={`第 ${i + 1} 步`}>
              {i + 1}
            </span>
            <div className="panel-bubble">{caption}</div>
            <div className="panel-art">
              <StepArt kind={stepKind(s.text, i, steps.length)} />
            </div>
            <p className="panel-text">{s.text}</p>
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

export function Tips({ tips }: { tips: string[] }) {
  if (!tips.length) return null
  return (
    <div className="tips">
      {tips.map((t, i) => (
        <p key={i} className="narration">
          <b>小贴士{tips.length > 1 ? ` ${i + 1}` : ''}</b>
          {t}
        </p>
      ))}
    </div>
  )
}

/** 完整内容（食材 + 步骤 + 贴士）。emptyAction：全空时空白格里放的按钮 */
export function RecipeBody({
  content,
  emptyHint,
  emptyAction,
}: {
  content: RecipeContent
  emptyHint?: string
  emptyAction?: React.ReactNode
}) {
  return (
    <>
      <section className="sec" aria-labelledby="sec-ing">
        <h2 className="sec-title" id="sec-ing">
          <span className="sec-mark" aria-hidden="true" />
          需要准备的食材
          {content.ingredients.length > 0 && <span className="sec-count">{content.ingredients.length} 样</span>}
        </h2>
        <IngredientNote items={content.ingredients} />
      </section>
      <section className="sec" aria-labelledby="sec-steps">
        <h2 className="sec-title" id="sec-steps">
          <span className="sec-mark sec-mark--green" aria-hidden="true" />
          做法漫画
          {content.steps.length > 0 && <span className="sec-count">{content.steps.length} 格</span>}
        </h2>
        {content.steps.length ? <ComicPanels steps={content.steps} /> : <EmptyPanels hint={emptyHint} action={emptyAction} />}
        <Tips tips={content.tips} />
      </section>
    </>
  )
}
