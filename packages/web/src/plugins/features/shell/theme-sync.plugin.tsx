/**
 * shell.theme-sync — keeps the document palette in sync with the stored
 * settings (the settings page and the cycle button both write there).
 */
import { defineFeature } from '../../define.ts'
import { useThemeSync } from '@/app/theme.ts'

function ThemeSync() {
  useThemeSync()
  return null
}

export default defineFeature({
  id: 'shell.theme-sync',
  capability: 'shell.theme-sync',
  title: '主题同步',
  description: '设置变化时把配色写回文档根节点；不渲染任何界面。',
  kind: 'slot',
  slot: 'shell.chrome',
  order: 10,
  render: ThemeSync,
})
