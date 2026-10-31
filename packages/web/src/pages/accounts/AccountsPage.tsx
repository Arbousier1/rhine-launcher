/**
 * Accounts page.
 *
 * Two flows share one list: offline accounts (created from a validated name)
 * and Microsoft accounts (OAuth device code, polled while the dialog is open).
 * The selected account is the one the shell's launch button will use.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import type { Account, DeviceCodeFlow } from '@rhine/core'
import { api } from '@/api/client'
import {
  Badge, Button, Dialog, EmptyState, Field, IconButton, Input, Panel, Spinner, Tooltip, toast,
} from '@/ui'
import { PlusIcon, RefreshIcon, TrashIcon, UserIcon } from '@/ui/icons'
import { PageHead } from '@/features/common/PageHead'
import { CopyButton, Notice, Placeholder, StatStrip } from '@/features/common/toolbar'
import { formatRelativeTime } from '@/features/format/index.ts'
import {
  accountKindLabel, avatarInitial, avatarUrl, countdown, formatUserCode, needsRefresh,
  remainingMs, shortUuid, sortAccounts, validateOfflineName,
} from '@/features/accounts/accounts.ts'
import { useAccountStore, useAppStore } from '@/stores'
import page from '@/features/common/page.module.css'
import styles from './accounts.module.css'

const POLL_INTERVAL_FALLBACK = 5000

export default function AccountsPage() {
  const accounts = useAppStore((state) => state.accounts)
  const reload = useAppStore((state) => state.reload)
  const currentId = useAccountStore((state) => state.currentId)
  const setCurrent = useAccountStore((state) => state.setCurrent)
  const flow = useAccountStore((state) => state.flow)
  const phase = useAccountStore((state) => state.phase)
  const flowError = useAccountStore((state) => state.flowError)
  const beginMicrosoft = useAccountStore((state) => state.beginMicrosoft)
  const cancelFlow = useAccountStore((state) => state.cancelFlow)
  const completeMicrosoft = useAccountStore((state) => state.completeMicrosoft)

  const [createOpen, setCreateOpen] = useState(false)
  const [authlibOpen, setAuthlibOpen] = useState(false)
  const [deviceOpen, setDeviceOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<Account | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const sorted = useMemo(() => sortAccounts(accounts, currentId ?? undefined), [accounts, currentId])
  const active = useMemo(
    () => accounts.find((account) => account.id === currentId) ?? accounts[0],
    [accounts, currentId],
  )

  // Fall back to the first account when the stored selection is stale.
  useEffect(() => {
    if (accounts.length === 0) return
    if (!currentId || !accounts.some((account) => account.id === currentId)) {
      setCurrent(accounts[0].id)
    }
  }, [accounts, currentId, setCurrent])

  const refreshAccounts = useCallback(async () => {
    await reload()
  }, [reload])

  const startMicrosoft = useCallback(async () => {
    setDeviceOpen(true)
    try {
      await beginMicrosoft()
    } catch (cause) {
      toast.show({ level: 'error', message: '无法开始微软登录：' + message(cause) })
    }
  }, [beginMicrosoft])

  const onRefresh = useCallback(
    async (account: Account) => {
      if (account.kind !== 'microsoft') {
        toast.show({ level: 'info', message: '离线账号无需刷新令牌' })
        return
      }
      setBusyId(account.id)
      try {
        await api.accounts.refresh(account.id)
        await refreshAccounts()
        toast.show({ level: 'ok', message: '已刷新 ' + account.name + ' 的登录状态' })
      } catch (cause) {
        toast.show({ level: 'error', message: '刷新失败：' + message(cause) })
      } finally {
        setBusyId(null)
      }
    },
    [refreshAccounts],
  )

  const onDelete = useCallback(async () => {
    if (!confirmDelete) return
    const target = confirmDelete
    setConfirmDelete(null)
    try {
      await api.accounts.remove(target.id)
      await refreshAccounts()
      toast.show({ level: 'ok', message: '已删除账号 ' + target.name })
    } catch (cause) {
      toast.show({ level: 'error', message: '删除失败：' + message(cause) })
    }
  }, [confirmDelete, refreshAccounts])

  const microsoftCount = accounts.filter((account) => account.kind === 'microsoft').length
  const expiring = accounts.filter((account) => needsRefresh(account)).length

  return (
    <div className={page.stack}>
      <PageHead
        caption="ACCOUNTS"
        title="账号"
        description="离线账号与微软账号；启动游戏时使用当前选中的身份"
        actions={
          <>
            <Button variant="ghost" leading={<UserIcon />} onClick={() => setCreateOpen(true)}>
              离线账号
            </Button>
            <Button variant="ghost" onClick={() => setAuthlibOpen(true)}>
              外置登录
            </Button>
            <Button
              variant="primary"
              leading={<PlusIcon />}
              onClick={() => void startMicrosoft()}
              disabled={phase === 'pending'}
            >
              微软登录
            </Button>
          </>
        }
      />

      <StatStrip
        items={[
          { caption: 'TOTAL', value: accounts.length, hint: '账号总数' },
          { caption: 'MICROSOFT', value: microsoftCount, hint: '正版账号' },
          { caption: 'OFFLINE', value: accounts.length - microsoftCount, hint: '离线账号' },
          { caption: 'EXPIRING', value: expiring, hint: '需要刷新' },
        ]}
      />

      <div className={page.columns}>
        <Panel
          caption="IDENTITIES"
          title="身份列表"
          actions={
            <IconButton label="刷新列表" onClick={() => void refreshAccounts()} disabled={busyId !== null}>
              <RefreshIcon />
            </IconButton>
          }
        >
          {accounts.length === 0 ? (
            <EmptyState
              title="还没有任何账号"
              description="创建一个离线账号即可离线游玩；微软账号可以加入正版服务器。"
              caption="NO ACCOUNT"
              action={
                <Button variant="primary" onClick={() => setCreateOpen(true)}>创建离线账号</Button>
              }
            />
          ) : (
            <div className={styles.section}>
              {sorted.map((account) => (
                <AccountRow
                  key={account.id}
                  account={account}
                  current={active?.id === account.id}
                  busy={busyId === account.id}
                  onSelect={() => setCurrent(account.id)}
                  onRefresh={() => void onRefresh(account)}
                  onDelete={() => setConfirmDelete(account)}
                />
              ))}
            </div>
          )}
        </Panel>

        <div className={page.side}>
          <Panel caption="CURRENT" title={active ? '当前身份' : '未选择'}>
            {active ? <ActiveAccount account={active} /> : <Placeholder>选择左侧任意账号。</Placeholder>}
          </Panel>

          <Panel caption="GUIDE" title="账号说明">
            <ul className={styles.codeSteps}>
              <li>离线账号：仅本机使用，UUID 由用户名派生，不能进入正版服务器。</li>
              <li>微软账号：通过设备码授权，令牌过期后需要刷新。</li>
              <li>启动时若令牌已过期，启动器会自动尝试刷新。</li>
            </ul>
          </Panel>
        </div>
      </div>

      <CreateOfflineDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={async (account) => {
          await refreshAccounts()
          setCurrent(account.id)
          toast.show({ level: 'ok', message: '已创建离线账号 ' + account.name })
        }}
      />

      <CreateAuthlibDialog
        open={authlibOpen}
        onClose={() => setAuthlibOpen(false)}
        onCreated={async (account) => {
          await refreshAccounts()
          setCurrent(account.id)
          toast.show({ level: 'ok', message: '已登录外置账号 ' + account.name })
        }}
      />

      <DeviceCodeDialog
        open={deviceOpen}
        flow={flow}
        phase={phase}
        error={flowError}
        onClose={() => {
          cancelFlow()
          setDeviceOpen(false)
        }}
        onFinished={async () => {
          const account = await completeMicrosoft()
          await refreshAccounts()
          setDeviceOpen(false)
          toast.show({ level: 'ok', message: '已登录 ' + account.name })
        }}
      />

      <Dialog
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        caption="REMOVE"
        title="删除账号"
        width={440}
        footer={
          <>
            <Button variant="quiet" onClick={() => setConfirmDelete(null)}>取消</Button>
            <Button variant="danger" onClick={() => void onDelete()}>删除</Button>
          </>
        }
      >
        <p>将从启动器中移除 <strong>{confirmDelete?.name}</strong>，不会影响你的 Mojang 账号本身。</p>
      </Dialog>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* rows                                                                */
/* ------------------------------------------------------------------ */

function AccountRow({ account, current, busy, onSelect, onRefresh, onDelete }: {
  account: Account
  current: boolean
  busy: boolean
  onSelect: () => void
  onRefresh: () => void
  onDelete: () => void
}) {
  const src = avatarUrl(account)
  return (
    <div
      className={clsx(page.row, styles.row, current && styles.currentMark)}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect()
        }
      }}
    >
      <span className={styles.avatar}>
        {src ? <img src={src} alt="" referrerPolicy="no-referrer" /> : avatarInitial(account)}
      </span>
      <div className={page.row__main}>
        <span className={styles.name}>
          <span className={styles.nameText}>{account.name}</span>
          {current ? <Badge tone="accent">当前</Badge> : null}
        </span>
        <span className={styles.meta}>
          <Badge tone={account.kind === 'microsoft' ? 'ok' : 'muted'}>{accountKindLabel(account)}</Badge>
          <span className="rh-mono">{shortUuid(account.uuid)}</span>
          {account.kind === 'microsoft' && account.expiresAt ? (
            <span>{needsRefresh(account) ? '登录已过期' : '有效至 ' + formatRelativeTime(account.expiresAt)}</span>
          ) : null}
        </span>
      </div>
      <div className={page.row__actions} onClick={(event) => event.stopPropagation()}>
        {account.kind === 'microsoft' ? (
          <Tooltip content="刷新登录">
            <IconButton
              label={'刷新 ' + account.name}
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={onRefresh}
            >
              {busy ? <Spinner size="sm" /> : <RefreshIcon />}
            </IconButton>
          </Tooltip>
        ) : null}
        <Tooltip content="删除">
          <IconButton
            label={'删除 ' + account.name}
            variant="ghost"
            size="sm"
            onClick={onDelete}
          >
            <TrashIcon />
          </IconButton>
        </Tooltip>
      </div>
    </div>
  )
}

function ActiveAccount({ account }: { account: Account }) {
  const src = avatarUrl(account)
  return (
    <div className={styles.section}>
      <div className={styles.avatarPreview}>
        <span className={clsx(styles.avatar, page['tile--lg'])}>
          {src ? <img src={src} alt="" referrerPolicy="no-referrer" /> : avatarInitial(account)}
        </span>
        <span className={styles.previewText}>
          <span className={styles.previewName}>{account.name}</span>
          <span className={styles.previewHint}>{accountKindLabel(account)}</span>
          <span className={styles.previewHint}>
            {account.kind === 'microsoft' && account.expiresAt
              ? needsRefresh(account) ? '登录已过期，请刷新' : '登录状态正常'
              : '离线身份' }
          </span>
        </span>
      </div>
      <div className={styles.divider} />
      <dl className={page.formRow__control}>
        <dt className="rh-caption">UUID</dt>
        <dd className="rh-mono">{account.uuid}</dd>
        {account.skinModel ? (
          <>
            <dt className="rh-caption">SKIN</dt>
            <dd>{account.skinModel === 'slim' ? '纤细（Alex）' : '经典（Steve）'}</dd>
          </>
        ) : null}
      </dl>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* create offline                                                      */
/* ------------------------------------------------------------------ */

function CreateOfflineDialog({ open, onClose, onCreated }: {
  open: boolean
  onClose: () => void
  onCreated: (account: Account) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const error = touched ? validateOfflineName(name) : undefined

  useEffect(() => {
    if (!open) return
    setName('')
    setTouched(false)
    setBusy(false)
  }, [open])

  const submit = async () => {
    setTouched(true)
    const problem = validateOfflineName(name)
    if (problem) return
    setBusy(true)
    try {
      const account = await api.accounts.addOffline(name.trim())
      await onCreated(account)
      onClose()
    } catch (cause) {
      toast.show({ level: 'error', message: '创建失败：' + message(cause) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      caption="OFFLINE"
      title="创建离线账号"
      width={480}
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>取消</Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>创建</Button>
        </>
      }
    >
      <div className={styles.createForm}>
        <Field
          label="用户名"
          required
          error={error}
          hint="3-16 个字符，只能包含字母、数字和下划线；不能使用保留名称。"
        >
          <Input
            autoFocus
            mono
            value={name}
            invalid={Boolean(error)}
            placeholder="Steve"
            maxLength={16}
            onChange={(event) => {
              setName(event.target.value)
              setTouched(true)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void submit()
            }}
          />
        </Field>

        <div className={styles.avatarPreview}>
          <span className={styles.avatar}>{(name.trim() || '?').slice(0, 1).toUpperCase()}</span>
          <span className={styles.previewText}>
            <span className={styles.previewName}>{name.trim() || '未命名'}</span>
            <span className={styles.previewHint}>预览 · UUID 由用户名派生</span>
          </span>
        </div>

        <Notice level="info" title="提示">
          离线账号不能进入需要正版验证的服务器；如需联机请使用微软登录。
        </Notice>
      </div>
    </Dialog>
  )
}
/* ------------------------------------------------------------------ */
/* create authlib-injector                                             */
/* ------------------------------------------------------------------ */

function CreateAuthlibDialog({ open, onClose, onCreated }: {
  open: boolean
  onClose: () => void
  onCreated: (account: Account) => Promise<void>
}) {
  const [url, setUrl] = useState('https://littleskin.cn/api/yggdrasil')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!url.trim() || !username.trim() || !password) return
    setBusy(true)
    setError(null)
    try {
      const account = await api.accounts.addAuthlibInjector(url.trim(), username.trim(), password)
      await onCreated(account)
      onClose()
    } catch (err: any) {
      setError(err.message || '外置登录失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      caption="AUTHLIB INJECTOR"
      title="添加外置账号 (authlib-injector)"
      width={460}
      footer={
        <>
          <Button variant="quiet" onClick={onClose} disabled={busy}>取消</Button>
          <Button variant="primary" onClick={() => void submit()} disabled={busy || !url.trim() || !username.trim() || !password}>
            {busy ? <Spinner size="sm" /> : '登录'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {error && <Notice level="danger">{error}</Notice>}
        <Field label="认证服务器 URL" caption="Yggdrasil API 地址，如 LittleSkin / Blessing Skin">
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/api/yggdrasil"
          />
        </Field>
        <Field label="用户名 / 邮箱">
          <Input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="player@example.com"
          />
        </Field>
        <Field label="密码">
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </Field>
      </div>
    </Dialog>
  )
}


/* ------------------------------------------------------------------ */
/* device code                                                         */
/* ------------------------------------------------------------------ */

function DeviceCodeDialog({ open, flow, phase, error, onClose, onFinished }: {
  open: boolean
  flow: DeviceCodeFlow | null
  phase: string
  error: string | null
  onClose: () => void
  onFinished: () => Promise<void>
}) {
  const [remaining, setRemaining] = useState(0)
  const [attempt, setAttempt] = useState(0)
  const [problem, setProblem] = useState<string | null>(null)
  const finishedRef = useRef(false)

  // Countdown ticker; also drives the expiry state.
  useEffect(() => {
    if (!open || !flow) return
    setRemaining(remainingMs(flow))
    const timer = window.setInterval(() => setRemaining(remainingMs(flow)), 1000)
    return () => window.clearInterval(timer)
  }, [open, flow])

  useEffect(() => {
    if (!open) {
      finishedRef.current = false
      setAttempt(0)
      setProblem(null)
    }
  }, [open])

  // Poll the backend until it reports an account or the flow expires.
  useEffect(() => {
    if (!open || !flow || phase !== 'pending') return
    let cancelled = false
    const interval = Math.max(1000, flow.intervalMs || POLL_INTERVAL_FALLBACK)

    const tick = async () => {
      if (cancelled) return
      if (remainingMs(flow) <= 0) {
        setProblem('设备码已过期，请重新开始登录')
        return
      }
      try {
        await onFinished()
        finishedRef.current = true
      } catch (cause) {
        // authorization_pending is the normal answer while the user is on
        // microsoft.com; anything else is surfaced but polling continues so a
        // transient network error does not kill the flow.
        const text = message(cause)
        if (!/pending|authorization_pending/i.test(text)) setProblem(text)
        if (!cancelled) setAttempt((value) => value + 1)
      }
    }

    const timer = window.setInterval(() => {
      if (!cancelled && !finishedRef.current) void tick()
    }, interval)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [open, flow, phase, onFinished, attempt])

  const openLink = useCallback(async () => {
    if (!flow) return
    try {
      await api.system.openExternal(flow.verificationUri)
    } catch (cause) {
      toast.show({ level: 'error', message: '无法打开浏览器：' + message(cause) })
    }
  }, [flow])

  return (
    <Dialog
      open={open}
      onClose={onClose}
      caption="MICROSOFT"
      title="微软账号登录"
      width={520}
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>取消</Button>
          {flow ? (
            <Button variant="primary" onClick={() => void openLink()}>在浏览器中打开</Button>
          ) : null}
        </>
      }
    >
      {error ? (
        <Notice level="danger" title="无法开始登录">{error}</Notice>
      ) : !flow ? (
        <div className={page.placeholder}><Spinner label="正在请求设备码" /></div>
      ) : (
        <div className={styles.section}>
          <div className={styles.codeCard}>
            <span className="rh-caption">DEVICE CODE</span>
            <span className={styles.codeValue}>{formatUserCode(flow.userCode)}</span>
            <div className={styles.codeRow}>
              <CopyButton
                value={flow.userCode}
                label="复制设备码"
                onCopied={() => toast.show({ level: 'ok', message: '设备码已复制' })}
                onFailed={() => toast.show({ level: 'warn', message: '复制失败，请手动选择设备码' })}
              />
              <span className={styles.countdown}>剩余 {countdown(remaining)}</span>
            </div>
          </div>

          <ol className={styles.codeSteps}>
            <li>点击「在浏览器中打开」，或手动访问
              <button type="button" className={styles.link} onClick={() => void openLink()}>
                {flow.verificationUri}
              </button>
            </li>
            <li>输入上方显示的设备码，并使用微软账号登录。</li>
            <li>授权完成后此窗口会自动关闭，无需手动操作。</li>
          </ol>

          {problem ? <Notice level="warn" title="等待中">{problem}</Notice> : null}

          <div className={styles.codeRow}>
            <Spinner size="sm" />
            <span className={styles.countdown}>等待授权…</span>
          </div>
        </div>
      )}
    </Dialog>
  )
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}