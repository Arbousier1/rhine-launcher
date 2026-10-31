/**
 * Rhine UI — the single public surface of the design system.
 *
 * Every page imports from '@/ui' exactly once; internal module layout is
 * free to change without touching call sites.
 */
export { Button, IconButton, Badge, StatusDot, Spinner, KeyCap, Divider, Skeleton } from './primitives.tsx'
export type { ButtonProps, ButtonVariant, IconButtonProps, BadgeProps, Tone, SpinnerProps } from './primitives.tsx'

export { Field, Input, Select, Textarea, Switch, Checkbox } from './form.tsx'
export type { FieldProps, InputProps, SelectProps, TextareaProps, SwitchProps, CheckboxProps } from './form.tsx'

export { Panel, PanelHeader, PanelRows, PanelRow } from './panel.tsx'
export type { PanelProps, PanelHeaderProps, PanelRowProps } from './panel.tsx'

export { Tabs } from './tabs.tsx'
export type { TabsProps, TabItem } from './tabs.tsx'

export { Progress, ProgressBar } from './progress.tsx'
export type { ProgressProps } from './progress.tsx'

export {
  Sparkline, EmptyState, Tooltip, StatGrid, DefinitionList, DefinitionItem,
} from './display.tsx'
export type { SparklineProps, EmptyStateProps, TooltipProps, StatItem } from './display.tsx'

export { Dialog } from './dialog.tsx'
export type { DialogProps } from './dialog.tsx'

export { ToastProvider, toast, useToast, useToastRecords } from './toast.tsx'
export type { ToastInput, ToastHandle, ToastLevel, ToastRecord } from './toast.tsx'

export {
  clampIndex, wrapIndex, moveInGrid, indexOfId, archiveNumber, relativeTime, formatPlayTime,
} from './grid-nav.ts'

export { PageHeader } from './page-head.tsx'
export type { PageHeaderProps } from './page-head.tsx'
