/**
 * motion.archive-array — the three-dimensional rack of instance slabs.
 *
 * The view renders this through a slot; disabling it falls back to the flat
 * grid, and re-enabling restores the rack without touching the page's data,
 * selection or launch flow.
 */
import { defineFeature } from '../../define.ts'
import { ArchiveArray } from '@/motion/archive-array.tsx'
import type { ArchiveArrayProps } from '@/motion/archive-array.tsx'

export default defineFeature({
  id: 'motion.archive-array',
  capability: 'motion.archive-array',
  title: '三维档案阵列',
  description: '实例以玻璃档案片排布；选中抬起，点击抽出后由卡片界面直接启动。',
  kind: 'motion',
  slot: 'archive.array',
  render: (props) => <ArchiveArray {...(props as unknown as ArchiveArrayProps)} />,
})
