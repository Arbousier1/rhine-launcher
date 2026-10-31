/**
 * Line icons drawn on a 16px grid with a single 1px stroke, matching the
 * hairline aesthetic. No icon font, no external dependency.
 */
import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

function base(props: IconProps) {
  return {
    width: 16,
    height: 16,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1,
    'aria-hidden': true as const,
    ...props,
  }
}

export function ArchiveIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="1.5" y="4.5" width="13" height="10" />
      <path d="M1.5 4.5L3.5 1.5h9l2 3" />
      <path d="M6 8h4" />
    </svg>
  )
}

export function LayersIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M8 1.5L14.5 5 8 8.5 1.5 5 8 1.5z" />
      <path d="M1.5 8.5L8 12l6.5-3.5" />
      <path d="M1.5 11.5L8 15l6.5-3.5" />
    </svg>
  )
}

export function CubeIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M8 1.5l6 3.25v6.5L8 14.5 2 11.25v-6.5L8 1.5z" />
      <path d="M2 4.75L8 8l6-3.25M8 8v6.5" />
    </svg>
  )
}

export function TagIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M1.8 2.2h5.1l7 7-4.7 4.7-7-7V2.2z" />
      <circle cx="5" cy="5.4" r="1.1" />
    </svg>
  )
}

export function GridIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="1.8" y="1.8" width="5.2" height="5.2" />
      <rect x="9" y="1.8" width="5.2" height="5.2" />
      <rect x="1.8" y="9" width="5.2" height="5.2" />
      <rect x="9" y="9" width="5.2" height="5.2" />
    </svg>
  )
}

export function UserIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="8" cy="5.5" r="2.75" />
      <path d="M2.5 14c.6-2.6 2.9-4 5.5-4s4.9 1.4 5.5 4" />
    </svg>
  )
}

export function SlidersIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M2 4.5h12M2 11.5h12" />
      <rect x="5" y="2.75" width="3" height="3.5" fill="var(--rhine-paper)" />
      <rect x="9" y="9.75" width="3" height="3.5" fill="var(--rhine-paper)" />
    </svg>
  )
}

export function CoffeeIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M2.5 4h9v5.5a4 4 0 0 1-4 4h-1a4 4 0 0 1-4-4V4z" />
      <path d="M11.5 5.5h1.5a2 2 0 0 1 0 4h-1.5" />
      <path d="M1 15h12" />
    </svg>
  )
}

export function TerminalIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="1.5" y="2.5" width="13" height="11" />
      <path d="M4 6l2.5 2L4 10M8.5 10.5h3.5" />
    </svg>
  )
}

export function PlusIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M8 2.5v11M2.5 8h11" />
    </svg>
  )
}

export function RefreshIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M13.5 8a5.5 5.5 0 1 1-1.9-4.16" />
      <path d="M13.5 1.5v3.2h-3.2" />
    </svg>
  )
}

export function PlayIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 2.5l9 5.5-9 5.5v-11z" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function SearchIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5L14 14" />
    </svg>
  )
}

export function CloseIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 3l10 10M13 3L3 13" />
    </svg>
  )
}

export function ChevronIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6 3.5L10.5 8 6 12.5" />
    </svg>
  )
}

export function ArrowLeftIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M13 8H3M6.5 4.5L3 8l3.5 3.5" />
    </svg>
  )
}

export function DownloadIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M8 1.5v8M4.5 6.5L8 10l3.5-3.5" />
      <path d="M2 13.5h12" />
    </svg>
  )
}

export function TrashIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4" />
    </svg>
  )
}

export function CopyIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="5.5" y="5.5" width="8" height="8" />
      <path d="M10.5 5.5v-3h-8v8h3" />
    </svg>
  )
}

export function FolderIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M1.5 3.5h4.5l1.5 2h7v7h-13v-9z" />
    </svg>
  )
}

export function AlertIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M8 1.5l6.5 12h-13L8 1.5z" />
      <path d="M8 6v3.5M8 11.5v.5" />
    </svg>
  )
}

export function CheckIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M2.5 8.5L6 12l7.5-8" />
    </svg>
  )
}

export function KeyboardIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="1.5" y="4.5" width="13" height="7" />
      <path d="M4 7h.01M6.5 7h.01M9 7h.01M11.5 7h.01M5 9.5h6" />
    </svg>
  )
}

export function MoonIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M13.5 9.5A6 6 0 0 1 6.5 2.5a6 6 0 1 0 7 7z" />
    </svg>
  )
}

/** Brand mark: the Rhine "archive" glyph used in the nav rail and boot screen. */
export function RhineMark(props: IconProps) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      aria-hidden="true"
      {...props}
    >
      <path d="M3 21V6.5L12 2l9 4.5V21" />
      <path d="M3 21h18" />
      <path d="M8 21v-7h8v7" />
      <path d="M8 10.5h8" />
    </svg>
  )
}