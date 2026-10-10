import type { ReactNode } from 'react'

/**
 * 線のアイコン。絵文字は端末ごとに見た目が変わり、画面の雰囲気が崩れるので使わない。
 * 色は文字色（currentColor）に合わせる
 */
function Icon({ size = 22, children, label }: { size?: number; children: ReactNode; label?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
      className="icon"
    >
      {children}
    </svg>
  )
}

type P = { size?: number; label?: string }

export const CupIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4.5 9h11v4.5a5.5 5.5 0 0 1-11 0z" />
    <path d="M15.5 10.5h1.2a2.3 2.3 0 0 1 0 4.6h-1.6" />
    <path d="M8 3.5c-.6.9.6 1.6 0 2.5M11.5 3.5c-.6.9.6 1.6 0 2.5" />
    <path d="M3.5 21h14" />
  </Icon>
)

export const NotebookIcon = (p: P) => (
  <Icon {...p}>
    <rect x="5" y="3.5" width="14" height="17" rx="2" />
    <path d="M8.5 3.5v17" />
    <circle cx="13.8" cy="10.5" r="2.7" />
    <path d="M11.5 16h4.5" />
  </Icon>
)

export const LeafIcon = (p: P) => (
  <Icon {...p}>
    <path d="M12 21V6" />
    <path d="M12 4c4 2.5 6 6 6 9.5S15 20 12 21c-3-1-6-4-6-7.5S8 6.5 12 4z" />
    <path d="M12 10l-3-1.5M12 10l3-1.5M12 14l-4-2M12 14l4-2" />
  </Icon>
)

export const SlidersIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
    <circle cx="15" cy="7" r="2" />
    <circle cx="9" cy="17" r="2" />
  </Icon>
)

export const CameraIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.2l1.4-2h5.8l1.4 2h2.2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" />
    <circle cx="12" cy="12.8" r="3.6" />
  </Icon>
)

export const VideoIcon = (p: P) => (
  <Icon {...p}>
    <rect x="3.5" y="6.5" width="12" height="11" rx="2" />
    <path d="M15.5 10.5l5-3v9l-5-3" />
  </Icon>
)

export const PhotoIcon = (p: P) => (
  <Icon {...p}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
    <circle cx="9" cy="10" r="1.8" />
    <path d="M20.5 16l-5-5-8 8.5" />
  </Icon>
)

export const BackIcon = (p: P) => (
  <Icon {...p}>
    <path d="M15 5l-7 7 7 7" />
  </Icon>
)

export const PlayIcon = (p: P) => (
  <Icon {...p}>
    <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none" />
  </Icon>
)

export const PauseIcon = (p: P) => (
  <Icon {...p}>
    <path d="M8 5.5v13M16 5.5v13" strokeWidth={2.4} />
  </Icon>
)

export const ScissorsIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="6.5" cy="7" r="2.5" />
    <circle cx="6.5" cy="17" r="2.5" />
    <path d="M8.6 8.4L20 17M8.6 15.6L20 7" />
  </Icon>
)

export const MicIcon = ({ off, ...p }: P & { off?: boolean }) => (
  <Icon {...p}>
    <rect x="9" y="3.5" width="6" height="11" rx="3" />
    <path d="M6 11.5a6 6 0 0 0 12 0M12 17.5v3" />
    {off && <path d="M4 4l16 16" />}
  </Icon>
)

export const StarIcon = ({ filled, ...p }: P & { filled?: boolean }) => (
  <Icon {...p}>
    <path
      d="M12 4.5l2.3 4.7 5.2.8-3.8 3.7.9 5.1L12 16.4l-4.6 2.4.9-5.1-3.8-3.7 5.2-.8z"
      fill={filled ? 'currentColor' : 'none'}
    />
  </Icon>
)

export const CheckIcon = (p: P) => (
  <Icon {...p}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Icon>
)

export const AlertIcon = (p: P) => (
  <Icon {...p}>
    <path d="M12 4l9 16H3z" />
    <path d="M12 10v4.5M12 17.2v.1" />
  </Icon>
)

export const PlusIcon = (p: P) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
)
