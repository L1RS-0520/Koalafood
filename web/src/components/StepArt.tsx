// 漫画格里的小插图（按步骤内容猜）
import type { StepKind } from '../lib/util'

const ART: Record<StepKind, React.ReactElement> = {
  knife: (
    <>
      <path d="M8 40L40 8l6 6-24 30z" fill="#fff" />
      <path d="M22 44l6 6-6 6-6-6z" fill="#8B5A2B" />
      <path d="M6 54h40" />
    </>
  ),
  wok: (
    <>
      <path d="M6 30c0 12 10 20 24 20s24-8 24-20z" fill="#3A3330" />
      <path d="M54 30l10-6" strokeWidth="5" />
      <circle cx="22" cy="20" r="4" fill="#FF7A2F" />
      <rect x="32" y="12" width="7" height="7" rx="1.5" fill="#FFD23F" />
      <path d="M40 24c3-3 6-3 8 0-3 2-5 2-8 0z" fill="#3DBE7A" />
    </>
  ),
  pot: (
    <>
      <path d="M10 26h44v18c0 6-4 10-10 10H20c-6 0-10-4-10-10z" fill="#FF7A2F" />
      <path d="M6 26h52M4 32h6M54 32h6" />
      <path d="M22 18c-2-4 2-6 0-10M32 18c-2-4 2-6 0-10M42 18c-2-4 2-6 0-10" stroke="#A7A9B4" />
    </>
  ),
  bowl: (
    <>
      <path d="M8 30h48c0 14-10 22-24 22S8 44 8 30z" fill="#FFF1B8" />
      <path d="M38 6L26 34" strokeWidth="4" />
      <path d="M16 30c4-4 8 2 12-2s8 2 12-2 6 2 8 0" fill="none" />
    </>
  ),
  steam: (
    <>
      <rect x="10" y="26" width="44" height="22" rx="6" fill="#F2D3A2" />
      <path d="M10 36h44" />
      <path d="M22 18c-2-4 2-6 0-10M32 18c-2-4 2-6 0-10M42 18c-2-4 2-6 0-10" stroke="#A7A9B4" />
    </>
  ),
  oven: (
    <>
      <rect x="8" y="10" width="48" height="44" rx="6" fill="#fff" />
      <rect x="14" y="22" width="36" height="24" rx="3" fill="#FFD23F" />
      <circle cx="18" cy="16" r="1.5" fill="#1E1A18" />
      <circle cx="26" cy="16" r="1.5" fill="#1E1A18" />
    </>
  ),
  plate: (
    <>
      <ellipse cx="32" cy="40" rx="26" ry="10" fill="#fff" />
      <path d="M16 38c2-10 10-16 16-16s14 6 16 16" fill="#FF9EB0" />
      <path d="M26 14l2 4M38 12l-1 5M32 10v5" stroke="#FFB020" />
    </>
  ),
  fridge: (
    <>
      <rect x="16" y="6" width="32" height="50" rx="5" fill="#E3F4EC" />
      <path d="M16 24h32M22 14v6M22 30v8" />
    </>
  ),
  spark: (
    <>
      <path d="M32 6l5 15 15 5-15 5-5 15-5-15-15-5 15-5z" fill="#FFD23F" />
    </>
  ),
}

export function StepArt({ kind }: { kind: StepKind }) {
  return (
    <svg className="step-art" viewBox="0 0 64 64" width="52" height="52" aria-hidden="true">
      <g stroke="#1E1A18" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none">
        {ART[kind]}
      </g>
    </svg>
  )
}
