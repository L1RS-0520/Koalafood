// 照片柜用量与限额提示（设计/2026-11-10-存储与限额状态.png，需求 v2.4.4 §12-23/24）。只给大王看，访客 401 → 不显示。
// - 容量：后端 capacity.level 直接定颜色：warn 黄 / danger 红（不拦上传）；未知按 ok。真满只认 507 STORAGE_FULL（弹框，只有「知道了」）。
// - 当天上传次数：daily_ops ≥80% 提醒；用完是 429 STORAGE_QUOTA（页面顶部提示条，不弹框，保存按钮照常可点）。
import { useCallback, useEffect, useState } from 'react'
import { api, STORAGE, STORAGE_ERROR_TEXT, STORAGE_TEXT, type Storage } from '../api'
import { cx } from '../lib/util'
import { Icon } from './Icon'
import { Koala } from './Koala'
import { Dialog } from './ui'

const MB = 1024 * 1024
const mb = (n: number) => Math.round(n / MB).toLocaleString('en-US')

export function useStorage(enabled: boolean) {
  const [s, setS] = useState<Storage | null>(null)
  const reload = useCallback(() => {
    if (!enabled) return
    api
      .getStorage()
      .then(setS)
      .catch(() => setS(null))
  }, [enabled])
  useEffect(reload, [reload])
  return [s, reload] as const
}

/** 当天次数只对 KV 存储有意义（约定 §3.5：别的存储后端也返回 limit=1000 但不拦，后端审查 P2-9） */
const opsOn = (s: Storage) => s.store === 'kv' && s.daily_ops.limit > 0
const opsPct = (s: Storage) => (opsOn(s) ? (s.daily_ops.used / s.daily_ops.limit) * 100 : 0)

/** 容量黄/红提示 + 当天上传次数提醒（ok 且次数正常时什么都不显示） */
export function StorageWarn({ s }: { s: Storage | null }) {
  if (!s) return null
  const lv = s.capacity.level
  const opsHigh = opsPct(s) >= STORAGE.opsWarnPct
  if (lv === 'ok' && !opsHigh) return null
  return (
    <div className="storage-warns">
      {lv !== 'ok' && (
        <div className={cx('cap-alert', `cap-alert--${lv}`)} role="status">
          <Icon name="alert" size={22} />
          <div>
            <span className="cap-tag">容量</span>
            <b>{lv === 'danger' ? STORAGE_TEXT.danger : STORAGE_TEXT.warn}</b>
            <small>{STORAGE_TEXT.hint}</small>
          </div>
        </div>
      )}
      {opsHigh && (
        <p className="ops-note" role="status">
          <span className="cap-tag cap-tag--ops">今日上传次数</span>
          今天已传 {s.daily_ops.used}/{s.daily_ops.limit} 次，快到上限啦，明天会自动恢复
        </p>
      )}
    </div>
  )
}

/** 设置页“照片柜”卡 */
export function StorageMeter({ s }: { s: Storage | null }) {
  if (!s) return null
  const c = s.capacity
  const pct = Math.min(100, Math.max(0, c.percent))
  return (
    <>
      <section className={cx('storage-card', `storage-card--${c.level}`)} aria-label="照片柜用量">
        <h2>
          <Icon name="photos" size={18} />
          照片柜
          <span className="storage-pct">{c.percent.toFixed(1)}%</span>
        </h2>
        <div className="storage-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label="照片柜已用比例">
          <i style={{ width: `${pct}%` }} />
        </div>
        <p className="storage-main">
          已用 {mb(c.used_bytes)} MB / {mb(c.limit_bytes)} MB，大约还能传 <b>{c.photos_left.toLocaleString('en-US')}</b> 张
        </p>
        <p className="storage-sub">
          已存 {s.photo_count} 张照片{opsOn(s) && ` · 今天已传 ${s.daily_ops.used}/${s.daily_ops.limit} 次`}
        </p>
      </section>
      <StorageWarn s={s} />
    </>
  )
}

/** 429：页面顶部提示条（不弹框） */
export function QuotaBanner({ onClose, page = 'edit' }: { onClose?: () => void; page?: 'upload' | 'edit' }) {
  return (
    <div className="quota-banner" role="alert">
      <Koala pose="think" size={58} />
      <div>
        <span className="cap-tag cap-tag--ops">今日上传次数</span>
        <b>{STORAGE_ERROR_TEXT.STORAGE_QUOTA}</b>
        <small>{page === 'upload' ? STORAGE_TEXT.quotaHintUpload : STORAGE_TEXT.quotaHint}</small>
      </div>
      {onClose && (
        <button type="button" className="quota-x" aria-label="关掉提示" onClick={onClose}>
          <Icon name="close" size={16} />
        </button>
      )}
    </div>
  )
}

/** 507：弹框，只有一个「知道了」 */
export function FullDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={STORAGE_ERROR_TEXT.STORAGE_FULL}
      art={<Koala pose="think" size={76} />}
      actions={
        <button type="button" className="btn btn--primary" onClick={onClose} data-autofocus>
          知道了
        </button>
      }
    >
      {STORAGE_TEXT.fullBody}
    </Dialog>
  )
}
