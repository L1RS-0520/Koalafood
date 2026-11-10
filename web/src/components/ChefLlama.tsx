// 厨驼：戴厨师帽的小羊驼（考拉的搭档），纯 SVG + CSS 动画；prefers-reduced-motion 时静止
import { cx } from '../lib/util'

type Pose = 'wok' | 'write' | 'idle' | 'sleep'

export function ChefLlama({
  pose = 'idle',
  size = 120,
  animated = true,
  className,
  title = '厨驼',
}: {
  pose?: Pose
  size?: number
  animated?: boolean
  className?: string
  title?: string
}) {
  const sleeping = pose === 'sleep'
  return (
    <svg
      className={cx('llama', `llama--${pose}`, animated && !sleeping && 'is-anim', className)}
      width={size}
      height={size * (150 / 140)}
      viewBox="0 0 140 150"
      role="img"
      aria-label={title}
    >
      <g stroke="#1E1A18" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round">
        {/* 地面影子 */}
        <ellipse cx="66" cy="143" rx="40" ry="4.5" fill="rgba(30,26,24,.16)" stroke="none" />

        <g className="llama-body">
          {/* 身体 */}
          <path d="M34 140c-2-20 6-33 18-37h28c12 4 20 17 18 37z" fill="#FFF3DC" />
          {/* 围裙（桉叶绿，和考拉的黄色围裙区分） */}
          <path d="M46 140c-1-14 3-24 10-29h20c7 5 11 15 10 29z" fill="#7CC6A4" />
          <path d="M57 122h18" stroke="#1E1A18" strokeWidth="2.4" />
          {/* 脖子 */}
          <path d="M53 105c-1-14 1-28 3-38h22c2 10 4 24 3 38z" fill="#FFF3DC" />
          {/* 领巾 */}
          <path d="M51 100c10 6 22 6 32 0l-3 9c-8 4-18 4-26 0z" fill="#FF7A2F" />
          <path d="M64 106l-4 11 7-4 7 4-4-11" fill="#FF7A2F" />

          <g className="llama-head">
            {/* 耳朵 */}
            <path d="M47 40c-8-6-10-17-6-24 7 2 12 11 12 20" fill="#FFF3DC" />
            <path d="M47 33c-3-4-4-9-3-12 3 2 5 6 6 10" fill="#FF9EB0" stroke="none" />
            <path d="M89 40c8-6 10-17 6-24-7 2-12 11-12 20" fill="#FFF3DC" />
            <path d="M89 33c3-4 4-9 3-12-3 2-5 6-6 10" fill="#FF9EB0" stroke="none" />
            {/* 脸 */}
            <path d="M44 52c0-14 11-22 24-22s24 8 24 22c0 8-3 13-6 17 1 9-7 16-18 16s-19-7-18-16c-3-4-6-9-6-17z" fill="#FFF3DC" />
            {/* 卷卷刘海 */}
            <path
              d="M50 38c-3-6 3-11 8-8 1-6 9-8 12-3 3-5 11-4 12 2 5-2 10 3 7 8-3 3-8 3-10 1-3 3-8 3-11 0-3 3-9 3-11 0-3 2-6 2-7 0z"
              fill="#FFFFFF"
            />
            {/* 嘴鼻 */}
            <ellipse cx="68" cy="70" rx="13" ry="9.5" fill="#FCE3C8" />
            <path d="M64 67.5c1.2 1 2.6 1 4 0M68 67.5c1.4 1 2.8 1 4 0" strokeWidth="2.2" fill="none" />
            <path className="llama-mouth" d="M63 73.5c2 2.6 8 2.6 10 0" strokeWidth="2.4" fill="none" />
            {/* 眼睛 */}
            {sleeping ? (
              <>
                <path d="M53 55c2.5 2.5 6 2.5 8.5 0M74.5 55c2.5 2.5 6 2.5 8.5 0" fill="none" />
              </>
            ) : (
              <g className="llama-eyes">
                <ellipse cx="57" cy="55" rx="4.2" ry="5.2" fill="#1E1A18" stroke="none" />
                <ellipse cx="79" cy="55" rx="4.2" ry="5.2" fill="#1E1A18" stroke="none" />
                <circle cx="58.4" cy="53" r="1.6" fill="#fff" stroke="none" />
                <circle cx="80.4" cy="53" r="1.6" fill="#fff" stroke="none" />
              </g>
            )}
            {/* 腮红 */}
            <ellipse cx="50" cy="63" rx="4.5" ry="2.6" fill="#FF9EB0" stroke="none" opacity=".85" />
            <ellipse cx="86" cy="63" rx="4.5" ry="2.6" fill="#FF9EB0" stroke="none" opacity=".85" />
            {/* 厨师帽 */}
            <g className="llama-hat">
              <path d="M52 31l-1-7h36l-1 7z" fill="#fff" />
              <path
                d="M51 24c-7-1-10-8-6-13 3-4 9-4 12-1 1-6 7-9 12-8 5 1 8 4 9 8 3-3 9-3 12 1 4 5 1 12-6 13z"
                fill="#fff"
              />
              <path d="M62 12c1 3 1 7 0 10M74 11c1 3 1 7 0 11" strokeWidth="2" fill="none" />
            </g>
          </g>
        </g>

        {pose === 'wok' && (
          <g className="llama-wok">
            {/* 炒锅 + 手 */}
            <path d="M84 104l22-8" strokeWidth="5" />
            <path d="M102 98c0 10 8 16 18 16s17-6 17-16z" fill="#3A3330" />
            <path d="M101 98h37" />
            <circle cx="86" cy="104" r="6" fill="#FFF3DC" />
            {/* 飞起来的菜 */}
            <g className="llama-food" stroke="#1E1A18" strokeWidth="2">
              <circle className="f1" cx="112" cy="86" r="4.5" fill="#FF7A2F" />
              <rect className="f2" x="120" y="78" width="7" height="7" rx="1.5" fill="#FFD23F" />
              <path className="f3" d="M128 88c3-4 7-4 9-1-3 3-6 3-9 1z" fill="#3DBE7A" />
            </g>
          </g>
        )}

        {pose === 'write' && (
          <g className="llama-write">
            {/* 菜谱本 */}
            <g transform="rotate(-8 108 112)">
              <rect x="88" y="94" width="40" height="40" rx="4" fill="#FFFDF6" />
              <path d="M88 101h40" stroke="#FF7A2F" strokeWidth="2" />
              <path className="w1" d="M94 110h26" strokeWidth="2" />
              <path className="w2" d="M94 118h22" strokeWidth="2" />
              <path className="w3" d="M94 126h18" strokeWidth="2" />
            </g>
            {/* 笔 */}
            <g className="llama-pen">
              <path d="M98 110l20-22 5 5-20 22-7 2z" fill="#FFD23F" />
              <path d="M118 88l5 5" />
            </g>
            <circle cx="84" cy="108" r="6" fill="#FFF3DC" />
          </g>
        )}

        {pose === 'idle' && <circle cx="84" cy="108" r="6" fill="#FFF3DC" />}

        {sleeping && (
          <g className="llama-zzz" stroke="none" fill="#1E1A18" fontFamily="var(--font-num)" fontWeight="800">
            <text x="100" y="40" fontSize="16">
              Z
            </text>
            <text x="112" y="26" fontSize="12">
              z
            </text>
          </g>
        )}
        {/* 蒸汽 */}
        {pose === 'wok' && (
          <g className="llama-steam" fill="none" strokeWidth="2.4" stroke="#A7A9B4">
            <path className="s1" d="M110 74c-3-4 3-6 0-10" />
            <path className="s2" d="M124 70c-3-4 3-6 0-10" />
          </g>
        )}
      </g>
    </svg>
  )
}
