/**
 * Shown by the host instead of a page whose view plugin is disabled.
 *
 * It is part of the plugin host (not a page): the route stays reachable and the
 * exact single-feature enable() call is one click away, so a disabled page is
 * recoverable without a reload.
 */
import { useState } from 'react'
import { Badge, Button, Panel, toast } from '@/ui'
import { webPlugins } from './registry.ts'
import type { WebFeatureEntry } from './types.ts'
import { useI18n } from '@/app/theme.ts'
import './feature-disabled.css'

export function DisabledFeatureNotice({ entry }: { entry: WebFeatureEntry }) {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)

  const enable = async () => {
    setBusy(true)
    try {
      await webPlugins.enable(entry.id)
      toast.show({ level: 'ok', message: entry.title + ' 已启用' })
    } catch (error) {
      toast.show({
        level: 'error',
        message: '启用失败：' + (error instanceof Error ? error.message : String(error)),
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel padded>
      <div className="rh-feature-off">
        <Badge tone="warn" mono>
          PLUGIN DISABLED
        </Badge>
        <h2 className="rh-feature-off__title">{t('plugins.disabled.notice')}</h2>
        <p className="rh-feature-off__hint">{t('plugins.disabled.hint')}</p>
        <code className="rh-feature-off__id">{entry.id}</code>
        <Button variant="primary" loading={busy} onClick={() => void enable()}>
          {t('plugins.disabled.action')}
        </Button>
      </div>
    </Panel>
  )
}
