// 菜谱编辑区：快速模式（一行一条的大文本框）/ 逐条模式（增删行、上下移动、火候时长对白）
import { useEffect, useRef, useState } from 'react'
import { LIMITS, splitIngredientLine, type Ingredient, type RecipeContent, type Step } from '../api'
import { cx } from '../lib/util'
import { Icon } from './Icon'

export type EditorMode = 'quick' | 'fine'

const ingToText = (xs: Ingredient[]) => xs.map((i) => (i.amount ? `${i.name} ${i.amount}` : i.name)).join('\n')
const stepToText = (xs: Step[]) => xs.map((s) => s.text).join('\n')
const lines = (t: string) =>
  t
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

/** 去掉空行，保存前调用 */
export function cleanContent(c: RecipeContent): RecipeContent {
  return {
    ingredients: c.ingredients.map((i) => ({ name: i.name.trim(), amount: i.amount.trim() })).filter((i) => i.name),
    steps: c.steps
      .map((s) => {
        const st: Step = { text: s.text.trim(), heat: s.heat.trim(), time: s.time.trim() }
        const cap = s.caption?.trim()
        if (cap) st.caption = [...cap].slice(0, LIMITS.captionMax).join('')
        return st
      })
      .filter((s) => s.text),
    tips: c.tips.map((t) => t.trim()).filter(Boolean),
    servings: c.servings?.trim() || null,
    total_time: c.total_time?.trim() || null,
  }
}

export const emptyContent = (): RecipeContent => ({ ingredients: [], steps: [], tips: [], servings: null, total_time: null })

const HEATS = ['小火', '中小火', '中火', '中大火', '大火']

export function RecipeEditor({
  value,
  onChange,
  mode,
  onModeChange,
  title = '菜谱',
}: {
  value: RecipeContent
  onChange: (c: RecipeContent) => void
  mode: EditorMode
  onModeChange: (m: EditorMode) => void
  title?: string
}) {
  // 快速模式下的原始文本（保留大王的换行/空格，不被解析结果覆盖）
  const [ingText, setIngText] = useState(() => ingToText(value.ingredients))
  const [stepText, setStepText] = useState(() => stepToText(value.steps))
  const [tipText, setTipText] = useState(() => value.tips.join('\n'))
  const prevMode = useRef(mode)
  useEffect(() => {
    if (prevMode.current !== mode && mode === 'quick') {
      setIngText(ingToText(value.ingredients))
      setStepText(stepToText(value.steps))
      setTipText(value.tips.join('\n'))
    }
    prevMode.current = mode
  }, [mode, value])

  const setQuick = (k: 'ing' | 'step' | 'tip', t: string) => {
    if (k === 'ing') {
      setIngText(t)
      onChange({ ...value, ingredients: lines(t).map(splitIngredientLine).filter((i) => i.name) })
    } else if (k === 'step') {
      setStepText(t)
      // 文本没变的行保留原来的火候/时长/对白
      onChange({
        ...value,
        steps: lines(t).map((text, i) => {
          const old = value.steps.find((s) => s.text === text) ?? (value.steps[i]?.text === text ? value.steps[i] : undefined)
          return old ? { ...old } : { text, heat: '', time: '' }
        }),
      })
    } else {
      setTipText(t)
      onChange({ ...value, tips: lines(t) })
    }
  }

  const upd = (patch: Partial<RecipeContent>) => onChange({ ...value, ...patch })
  const move = <T,>(arr: T[], i: number, d: number): T[] => {
    const j = i + d
    if (j < 0 || j >= arr.length) return arr
    const n = arr.slice()
    ;[n[i], n[j]] = [n[j], n[i]]
    return n
  }

  return (
    <section className="editor" aria-label={`${title}编辑区`}>
      <div className="editor-head">
        <h2 className="sec-title">
          <span className="sec-mark sec-mark--green" aria-hidden="true" />
          {title}
        </h2>
        <div className="seg" role="radiogroup" aria-label="编辑方式">
          <button type="button" role="radio" aria-checked={mode === 'quick'} className={cx(mode === 'quick' && 'on')} onClick={() => onModeChange('quick')}>
            快速填写
          </button>
          <button type="button" role="radio" aria-checked={mode === 'fine'} className={cx(mode === 'fine' && 'on')} onClick={() => onModeChange('fine')}>
            逐条编辑
          </button>
        </div>
      </div>

      <div className="editor-meta">
        <label className="mini-field">
          <span>
            <Icon name="users" size={16} />
            份量
          </span>
          <input value={value.servings ?? ''} placeholder="如 2人份" maxLength={20} onChange={(e) => upd({ servings: e.target.value })} />
        </label>
        <label className="mini-field">
          <span>
            <Icon name="clock" size={16} />
            总时长
          </span>
          <input value={value.total_time ?? ''} placeholder="如 20分钟" maxLength={20} onChange={(e) => upd({ total_time: e.target.value })} />
        </label>
      </div>

      {mode === 'quick' ? (
        <div className="quick">
          <label className="field">
            <span className="field-label">
              食材 <em>一行一个，“鸡蛋 3个”会自动拆成名称和用量</em>
            </span>
            <textarea
              className="textarea textarea--lined"
              rows={5}
              value={ingText}
              placeholder={'鸡蛋 3个\n番茄 2个\n盐 适量'}
              onChange={(e) => setQuick('ing', e.target.value)}
            />
          </label>
          {value.ingredients.length > 0 && (
            <ul className="parsed" aria-label="识别结果">
              {value.ingredients.map((i, k) => (
                <li key={k}>
                  <b>{i.name}</b>
                  {i.amount && <span>{i.amount}</span>}
                </li>
              ))}
            </ul>
          )}
          <label className="field">
            <span className="field-label">
              步骤 <em>一行一步，按顺序写</em>
            </span>
            <textarea
              className="textarea textarea--lined"
              rows={6}
              value={stepText}
              placeholder={'鸡蛋打散加一点盐\n热锅下油，炒到七成熟盛出\n番茄炒出汁，倒回鸡蛋翻匀'}
              onChange={(e) => setQuick('step', e.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">
              小贴士 <em>可不填</em>
            </span>
            <textarea className="textarea" rows={2} value={tipText} placeholder="比如：番茄选熟透的更出汁" onChange={(e) => setQuick('tip', e.target.value)} />
          </label>
          <p className="field-hint">都空着也能保存，以后想起来再补～</p>
        </div>
      ) : (
        <div className="fine">
          <h3 className="fine-title">食材</h3>
          <ul className="rows">
            {value.ingredients.map((it, i) => (
              <li key={i} className="row row--ing">
                <input
                  className="input"
                  aria-label={`第 ${i + 1} 样食材名称`}
                  placeholder="名称"
                  value={it.name}
                  onChange={(e) => upd({ ingredients: value.ingredients.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)) })}
                />
                <input
                  className="input input--amt"
                  aria-label={`第 ${i + 1} 样食材用量`}
                  placeholder="用量"
                  value={it.amount}
                  onChange={(e) => upd({ ingredients: value.ingredients.map((x, k) => (k === i ? { ...x, amount: e.target.value } : x)) })}
                />
                <button type="button" className="icon-btn icon-btn--sm" aria-label={`删除第 ${i + 1} 样食材`} onClick={() => upd({ ingredients: value.ingredients.filter((_, k) => k !== i) })}>
                  <Icon name="trash" size={18} />
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="btn btn--dashed" onClick={() => upd({ ingredients: [...value.ingredients, { name: '', amount: '' }] })}>
            <Icon name="plus" size={18} />
            加一样食材
          </button>

          <h3 className="fine-title">步骤</h3>
          <ol className="rows">
            {value.steps.map((s, i) => (
              <li key={i} className="row row--step">
                <span className="row-no" aria-hidden="true">
                  {i + 1}
                </span>
                <div className="row-main">
                  <textarea
                    className="textarea"
                    rows={2}
                    aria-label={`第 ${i + 1} 步内容`}
                    placeholder="这一步做什么"
                    value={s.text}
                    onChange={(e) => upd({ steps: value.steps.map((x, k) => (k === i ? { ...x, text: e.target.value } : x)) })}
                  />
                  <div className="row-sub">
                    <input
                      className="input input--sm"
                      list="heat-list"
                      aria-label={`第 ${i + 1} 步火候`}
                      placeholder="火候"
                      value={s.heat}
                      onChange={(e) => upd({ steps: value.steps.map((x, k) => (k === i ? { ...x, heat: e.target.value } : x)) })}
                    />
                    <input
                      className="input input--sm"
                      aria-label={`第 ${i + 1} 步时长`}
                      placeholder="时长"
                      value={s.time}
                      onChange={(e) => upd({ steps: value.steps.map((x, k) => (k === i ? { ...x, time: e.target.value } : x)) })}
                    />
                    <input
                      className="input input--sm input--cap"
                      aria-label={`第 ${i + 1} 步漫画对白`}
                      placeholder="对白（可空）"
                      maxLength={LIMITS.captionMax}
                      value={s.caption ?? ''}
                      onChange={(e) => upd({ steps: value.steps.map((x, k) => (k === i ? { ...x, caption: e.target.value } : x)) })}
                    />
                  </div>
                </div>
                <div className="row-tools">
                  <button type="button" className="icon-btn icon-btn--sm" aria-label={`第 ${i + 1} 步上移`} disabled={i === 0} onClick={() => upd({ steps: move(value.steps, i, -1) })}>
                    <Icon name="up" size={18} />
                  </button>
                  <button type="button" className="icon-btn icon-btn--sm" aria-label={`第 ${i + 1} 步下移`} disabled={i === value.steps.length - 1} onClick={() => upd({ steps: move(value.steps, i, 1) })}>
                    <Icon name="down" size={18} />
                  </button>
                  <button type="button" className="icon-btn icon-btn--sm" aria-label={`删除第 ${i + 1} 步`} onClick={() => upd({ steps: value.steps.filter((_, k) => k !== i) })}>
                    <Icon name="trash" size={18} />
                  </button>
                </div>
              </li>
            ))}
          </ol>
          <datalist id="heat-list">
            {HEATS.map((h) => (
              <option key={h} value={h} />
            ))}
          </datalist>
          <button type="button" className="btn btn--dashed" onClick={() => upd({ steps: [...value.steps, { text: '', heat: '', time: '' }] })}>
            <Icon name="plus" size={18} />
            加一步
          </button>

          <h3 className="fine-title">小贴士</h3>
          <ul className="rows">
            {value.tips.map((t, i) => (
              <li key={i} className="row row--ing">
                <input className="input" aria-label={`第 ${i + 1} 条小贴士`} value={t} placeholder="小贴士" onChange={(e) => upd({ tips: value.tips.map((x, k) => (k === i ? e.target.value : x)) })} />
                <button type="button" className="icon-btn icon-btn--sm" aria-label={`删除第 ${i + 1} 条小贴士`} onClick={() => upd({ tips: value.tips.filter((_, k) => k !== i) })}>
                  <Icon name="trash" size={18} />
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="btn btn--dashed" onClick={() => upd({ tips: [...value.tips, ''] })}>
            <Icon name="plus" size={18} />
            加一条小贴士
          </button>
        </div>
      )}
    </section>
  )
}
