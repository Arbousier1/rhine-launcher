/**
 * shell.sessions — running launch sessions in the nav footer, with kill.
 */
import { useMemo } from 'react'
import { defineFeature } from '../../define.ts'
import { IconButton, StatusDot, toast } from '@/ui'
import { api } from '@/api/client'
import { activeSessions, useAppStore } from '@/app/data.ts'
import { useI18n } from '@/app/theme.ts'

function SessionList() {
  const { t } = useI18n()
  const sessions = useAppStore((state) => state.sessions)
  const running = useMemo(() => activeSessions(sessions), [sessions])

  if (running.length === 0) {
    return (
      <div className="rh-nav__statusline">
        <StatusDot tone="muted" />
        <span className="rh-truncate">{t('shell.noSession')}</span>
      </div>
    )
  }

  const kill = async (sessionId: string) => {
    try {
      await api.launch.kill(sessionId)
      toast.show({ level: 'warn', message: '已请求终止会话 ' + sessionId })
    } catch (cause) {
      toast.show({
        level: 'error',
        message: '终止失败：' + (cause instanceof Error ? cause.message : String(cause)),
      })
    }
  }

  return (
    <>
      {running.slice(0, 2).map((session) => (
        <div className="rh-nav__session" key={session.id}>
          <StatusDot tone="accent" pulse />
          <span className="rh-nav__sessionname">{session.instanceId}</span>
          <IconButton
            label={t('shell.kill')}
            size="sm"
            variant="danger"
            onClick={() => void kill(session.id)}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <rect x="1" y="1" width="8" height="8" fill="currentColor" />
            </svg>
          </IconButton>
        </div>
      ))}
    </>
  )
}

export default defineFeature({
  id: 'shell.sessions',
  capability: 'shell.sessions',
  title: '运行会话',
  description: '导航底部显示运行中的启动会话，并可请求终止。',
  kind: 'slot',
  slot: 'shell.nav.sessions',
  order: 10,
  render: SessionList,
})
