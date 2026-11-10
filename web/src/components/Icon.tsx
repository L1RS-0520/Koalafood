// 手绘感线性图标（2.4px 墨线），不用 emoji，跨系统一致
import type { ReactElement, SVGProps } from 'react'

export type IconName =
  | 'back'
  | 'gear'
  | 'plus'
  | 'close'
  | 'trash'
  | 'edit'
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'camera'
  | 'image'
  | 'clock'
  | 'flame'
  | 'users'
  | 'check'
  | 'star'
  | 'bowl'
  | 'crown'
  | 'alert'
  | 'photos'
  | 'key'
  | 'pencil'
  | 'refresh'
  | 'grip'
  | 'expand'
  | 'logout'
  | 'chef'
  | 'more'

const P: Record<IconName, ReactElement> = {
  back: <path d="M15 5l-7 7 7 7" />,
  left: <path d="M15 5l-7 7 7 7" />,
  right: <path d="M9 5l7 7-7 7" />,
  up: <path d="M5 15l7-7 7 7" />,
  down: <path d="M5 9l7 7 7-7" />,
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  gear: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.8v2.6M12 18.6v2.6M21.2 12h-2.6M5.4 12H2.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8M18.5 18.5l-1.8-1.8M7.3 7.3L5.5 5.5" />
      <circle cx="12" cy="12" r="6.6" />
    </>
  ),
  trash: (
    <>
      <path d="M4.5 6.5h15M9.5 6.5V4.5h5v2" />
      <path d="M6.5 6.5l1 13h9l1-13" />
      <path d="M10 10v6M14 10v6" />
    </>
  ),
  edit: (
    <>
      <path d="M4 20l1-4.5L15.5 5a2.1 2.1 0 013 3L8 18.5z" />
      <path d="M13.5 7l3 3" />
    </>
  ),
  pencil: (
    <>
      <path d="M4 20l1-4.5L15.5 5a2.1 2.1 0 013 3L8 18.5z" />
      <path d="M13.5 7l3 3" />
    </>
  ),
  camera: (
    <>
      <path d="M3.5 8.5h3.5l1.8-2.5h6.4L17 8.5h3.5v11h-17z" />
      <circle cx="12" cy="13.5" r="3.4" />
    </>
  ),
  image: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <circle cx="9" cy="10" r="1.8" />
      <path d="M4 17.5l5-4.5 4 3.5 3-2.5 4 3.5" />
    </>
  ),
  photos: (
    <>
      <rect x="6.5" y="3.5" width="14" height="12" rx="2" />
      <path d="M3.5 7.5v11a2 2 0 002 2h11" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" fill="var(--accent)" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  flame: <path d="M12 21c-4 0-6.5-2.6-6.5-6 0-3.6 3-5.6 3.6-9.5 2.3 1.4 3.4 3.3 3.4 5.3 1-.6 1.6-1.7 1.8-3 2.3 1.9 4.2 4.4 4.2 7.2 0 3.4-2.5 6-6.5 6z" fill="var(--primary)" />,
  users: (
    <>
      <circle cx="9" cy="8.5" r="3.2" />
      <path d="M3.5 19.5c.6-3.4 2.8-5.2 5.5-5.2s4.9 1.8 5.5 5.2" />
      <circle cx="16.5" cy="9" r="2.6" />
      <path d="M15.5 14.4c2.5-.3 4.6 1.4 5 4.6" />
    </>
  ),
  crown: <path d="M4 17.5h16M5 15l-1.5-8 5 3.5L12 5l3.5 5.5 5-3.5L19 15z" fill="var(--accent)" />,
  bowl: (
    <>
      <path d="M3.5 11h17c0 4.7-3.8 8-8.5 8s-8.5-3.3-8.5-8z" />
      <path d="M8 7.5c0-1.5 1.5-1.5 1.5-3M12 7.5c0-1.5 1.5-1.5 1.5-3" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3.5l9.5 16.5h-19z" />
      <path d="M12 10v4.5M12 17.2v.3" />
    </>
  ),
  star: <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z" fill="var(--accent)" />,
  key: (
    <>
      <circle cx="8" cy="12" r="4" />
      <path d="M12 12h8.5M17.5 12v3M20.5 12v2.2" />
    </>
  ),
  refresh: (
    <>
      <path d="M19.5 11A7.5 7.5 0 006 7.2L4.5 9" />
      <path d="M4.5 4.5V9H9" />
      <path d="M4.5 13A7.5 7.5 0 0018 16.8l1.5-1.8" />
      <path d="M19.5 19.5V15H15" />
    </>
  ),
  grip: (
    <>
      <circle cx="9" cy="7" r="1.1" fill="currentColor" />
      <circle cx="15" cy="7" r="1.1" fill="currentColor" />
      <circle cx="9" cy="12" r="1.1" fill="currentColor" />
      <circle cx="15" cy="12" r="1.1" fill="currentColor" />
      <circle cx="9" cy="17" r="1.1" fill="currentColor" />
      <circle cx="15" cy="17" r="1.1" fill="currentColor" />
    </>
  ),
  expand: <path d="M4.5 9.5v-5h5M19.5 9.5v-5h-5M4.5 14.5v5h5M19.5 14.5v5h-5" />,
  logout: (
    <>
      <path d="M10 4.5H5.5v15H10" />
      <path d="M14 8l4 4-4 4M18 12H9" />
    </>
  ),
  more: (
    <>
      <circle cx="6" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="18" cy="12" r="1.6" fill="currentColor" stroke="none" />
    </>
  ),
  chef: (
    <>
      <path d="M7 14.5V19h10v-4.5" />
      <path d="M7 14.5a4 4 0 01-.6-7.9 5 5 0 019.2-1.2 4 4 0 011.4 9.1z" fill="#fff" />
      <path d="M7 16.5h10" />
    </>
  ),
}

export function Icon({ name, size = 22, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {P[name]}
    </svg>
  )
}
