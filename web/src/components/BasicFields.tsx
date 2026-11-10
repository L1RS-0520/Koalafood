// 菜名 / 分类 / 备注
import { CATEGORIES, LIMITS } from '../api'
import { categoryTone } from '../lib/category'
import { cx, len } from '../lib/util'

export interface Basics {
  name: string
  category: string
  note: string
}
export type BasicErrors = Partial<Record<'name' | 'category' | 'note' | 'photos', string>>

export function validateBasics(b: Basics): BasicErrors {
  const e: BasicErrors = {}
  if (!b.name.trim()) e.name = '菜名还没写呢'
  else if (len(b.name.trim()) > LIMITS.nameMax) e.name = `菜名最多 ${LIMITS.nameMax} 个字`
  if (!b.category) e.category = '选一个分类吧'
  if (len(b.note) > LIMITS.noteMax) e.note = `备注最多 ${LIMITS.noteMax} 个字`
  return e
}

export function BasicFields({
  value,
  onChange,
  errors,
  notePlaceholder = '比如：少放辣、加了土豆（厨驼会照着写）',
}: {
  value: Basics
  onChange: (b: Basics) => void
  errors: BasicErrors
  notePlaceholder?: string
}) {
  const nameLen = len(value.name)
  const noteLen = len(value.note)
  return (
    <>
      <label className={cx('field', errors.name && 'is-invalid')}>
        <span className="field-label">
          菜名 <i className="req">必填</i>
        </span>
        <input
          className="input input--lg"
          id="f-name"
          value={value.name}
          placeholder="比如：番茄炒蛋"
          aria-invalid={!!errors.name}
          aria-describedby="f-name-msg"
          onChange={(e) => onChange({ ...value, name: e.target.value })}
        />
        <span className="field-foot" id="f-name-msg">
          {errors.name ? (
            <span className="field-error" role="alert">
              {errors.name}
            </span>
          ) : (
            <span />
          )}
          <span className={cx('counter', nameLen > LIMITS.nameMax && 'over')}>
            {nameLen}/{LIMITS.nameMax}
          </span>
        </span>
      </label>

      <fieldset className={cx('field', errors.category && 'is-invalid')} id="f-category">
        <legend className="field-label">
          分类 <i className="req">必选</i>
        </legend>
        <div className="chips" role="radiogroup" aria-label="分类">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={value.category === c}
              className={cx('chip-pick', `chip-pick--${categoryTone(c)}`, value.category === c && 'on')}
              onClick={() => onChange({ ...value, category: c })}
            >
              {c}
            </button>
          ))}
        </div>
        {errors.category && (
          <span className="field-error" role="alert">
            {errors.category}
          </span>
        )}
      </fieldset>

      <label className={cx('field', errors.note && 'is-invalid')}>
        <span className="field-label">
          备注 <em>可不填</em>
        </span>
        <textarea
          className="textarea"
          id="f-note"
          rows={2}
          value={value.note}
          placeholder={notePlaceholder}
          onChange={(e) => onChange({ ...value, note: e.target.value })}
        />
        <span className="field-foot">
          {errors.note ? (
            <span className="field-error" role="alert">
              {errors.note}
            </span>
          ) : (
            <span />
          )}
          <span className={cx('counter', noteLen > LIMITS.noteMax && 'over')}>
            {noteLen}/{LIMITS.noteMax}
          </span>
        </span>
      </label>
    </>
  )
}
