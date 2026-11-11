// 详情页菜谱：2×2 四格步骤 +「更多」（食材、备注、小贴士、完整步骤）。功能都保留，装饰收进「更多」。
import { useState } from 'react'
import type { Ingredient, RecipeContent, Step } from '../api'
import { cx, stepKind, stepShort } from '../lib/util'
import { Dialog } from './ui'
import { StepArt } from './StepArt'

export function IngredientList({ items }: { items: Ingredient[] }) {
  const [got, setGot] = useState<Set<number>>(new Set())
  if (items.length === 0) return null
  return (
    <ul className="more-list">
      {items.map((it, i) => {
        const on = got.has(i)
        return (
          <li key={`${it.name}-${i}`}>
            <button
              type="button"
              className={cx('more-ing', on && 'on')}
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
              <span className="more-ing-name">{it.name}</span>
              <span className="more-ing-amt">{it.amount || '适量'}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

export function Yonkoma({ steps, onOpen }: { steps: Step[]; onOpen: (i: number) => void }) {
  if (steps.length === 0) return null
  const total = steps.length
  return (
    <ol className="yonkoma">
      {steps.map((s, i) => (
        <li key={i}>
          <button type="button" className="cell" onClick={() => onOpen(i)} aria-label={`第 ${i + 1} 步：${stepShort(s)}`}>
            <span className="cell-num" aria-hidden="true">
              {i + 1}
            </span>
            <div className="cell-pic">
              <StepArt kind={stepKind(s.text, i, total)} index={i} />
            </div>
            <p className="cell-cap">{stepShort(s)}</p>
          </button>
        </li>
      ))}
    </ol>
  )
}

export function StepDialog({
  steps,
  index,
  onClose,
}: {
  steps: Step[]
  index: number | null
  onClose: () => void
}) {
  const step = index != null ? steps[index] : null
  const meta = [step?.heat, step?.time].filter(Boolean).join(' · ')
  return (
    <Dialog
      open={index != null && !!step}
      onClose={onClose}
      title={index != null ? `第 ${index + 1} 步` : '步骤'}
      actions={
        <button type="button" className="btn btn--primary" onClick={onClose} data-autofocus>
          关闭
        </button>
      }
    >
      {step && (
        <div className="step-dialog">
          <div className="step-dialog-pic">
            <StepArt kind={stepKind(step.text, index ?? 0, steps.length)} index={index ?? 0} />
          </div>
          {meta && <p className="step-dialog-meta">{meta}</p>}
          <p className="step-dialog-text">{step.text}</p>
        </div>
      )}
    </Dialog>
  )
}

export function MoreSection({
  content,
  note,
  source,
}: {
  content: RecipeContent
  note?: string | null
  source?: string | null
}) {
  const [open, setOpen] = useState(false)
  const hasSteps = content.steps.length > 0
  const hasIng = content.ingredients.length > 0
  const hasTips = content.tips.length > 0
  const hasNote = !!note?.trim()
  const empty = !hasSteps && !hasIng && !hasTips && !hasNote && !source
  return (
    <div className="more-wrap">
      <button type="button" className="more" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        更多（食材、备注、小贴士）
      </button>
      {open && (
        <div className="more-panel">
          {hasSteps && (
            <section className="more-sec" aria-labelledby="more-steps">
              <h2 className="more-title" id="more-steps">
                完整步骤
              </h2>
              <ol className="more-steps">
                {content.steps.map((s, i) => {
                  const meta = [s.heat, s.time].filter(Boolean).join(' · ')
                  return (
                    <li key={i}>
                      <span className="more-step-no">{i + 1}</span>
                      <div>
                        <p>{s.text}</p>
                        {meta && <p className="more-step-meta">{meta}</p>}
                      </div>
                    </li>
                  )
                })}
              </ol>
            </section>
          )}
          {hasIng && (
            <section className="more-sec" aria-labelledby="more-ing">
              <h2 className="more-title" id="more-ing">
                食材
                <span className="more-hint">点一下划掉</span>
              </h2>
              <IngredientList items={content.ingredients} />
            </section>
          )}
          {hasNote && (
            <section className="more-sec" aria-labelledby="more-note">
              <h2 className="more-title" id="more-note">
                备注
              </h2>
              <p className="more-note">{note}</p>
            </section>
          )}
          {hasTips && (
            <section className="more-sec" aria-labelledby="more-tips">
              <h2 className="more-title" id="more-tips">
                小贴士
              </h2>
              <ul className="more-tips">
                {content.tips.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </section>
          )}
          {source && <p className="detail-foot">{source}</p>}
          {empty && <p className="more-empty">还没有更多内容</p>}
        </div>
      )}
    </div>
  )
}

/** 四格 + 更多 + 点开步骤。emptyAction：没有步骤时给大王的入口 */
export function RecipeBody({
  content,
  note,
  source,
  emptyHint,
  emptyAction,
}: {
  content: RecipeContent
  note?: string | null
  source?: string | null
  emptyHint?: string
  emptyAction?: React.ReactNode
}) {
  const [open, setOpen] = useState<number | null>(null)
  const hasSteps = content.steps.length > 0
  return (
    <>
      {hasSteps ? (
        <Yonkoma steps={content.steps} onOpen={setOpen} />
      ) : (
        <div className="yonkoma-empty">
          <p>{emptyHint ?? '还没写步骤'}</p>
          {emptyAction && <div className="center-actions">{emptyAction}</div>}
        </div>
      )}
      <MoreSection content={content} note={note} source={source} />
      <StepDialog steps={content.steps} index={open} onClose={() => setOpen(null)} />
    </>
  )
}
