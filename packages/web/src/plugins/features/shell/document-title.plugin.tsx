/**
 * shell.document-title — keeps document.title in step with the locale.
 */
import { useEffect } from 'react'
import { defineFeature } from '../../define.ts'
import { useI18n } from '@/app/theme.ts'

function DocumentTitle() {
  const { t } = useI18n()
  useEffect(() => {
    if (typeof document === 'undefined') return
    document.title = 'Rhine Launcher · ' + t('archive.title')
  }, [t])
  return null
}

export default defineFeature({
  id: 'shell.document-title',
  capability: 'shell.document-title',
  title: '窗口标题',
  description: '随语言切换更新浏览器标签标题；不渲染任何界面。',
  kind: 'slot',
  slot: 'shell.chrome',
  order: 20,
  render: DocumentTitle,
})
