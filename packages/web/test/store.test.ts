/**
 * Behavioural tests for the shell store.
 *
 * These exercise the real event-reduction rules (task caps, instance patching,
 * notice buffering) and the genuine offline path: no fetch is mocked, the
 * request simply has no server behind it in the test environment, which is
 * exactly the "backend not started" case the UI must survive.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Instance, LaunchSession, ServerEvent, TaskSnapshot } from '@rhine/core'
import {
  activeSessions, clearNotices, currentNotices, formatBytes, pushNotice, useAppStore,
} from '../src/app/data.ts'

function makeInstance(patch: Partial<Instance> = {}): Instance {
  return {
    id: 'i1',
    name: '档案一',
    gameVersion: '26.3',
    loaders: [],
    memory: { minMb: 1024, maxMb: 4096 },
    jvmArgs: [],
    gameArgs: [],
    window: { width: 1280, height: 720, fullscreen: false },
    path: '/data/instances/i1',
    revision: 1,
    createdAt: 1,
    playTimeMs: 0,
    ...patch,
  }
}

function makeTask(id: string, status: TaskSnapshot['status'] = 'running'): TaskSnapshot {
  return {
    id,
    kind: 'install',
    title: '安装 ' + id,
    status,
    progress: { value: 0.5, stage: 'download', current: 5, total: 10 },
    logs: [],
    createdAt: 1,
  }
}

function makeSession(id: string, status: LaunchSession['status'] = 'running'): LaunchSession {
  return {
    id,
    instanceId: 'i1',
    accountName: 'Steve',
    startedAt: 1,
    status,
    command: ['java'],
    logFile: '/log',
  }
}

beforeEach(() => {
  useAppStore.setState({
    status: 'idle',
    error: null,
    connection: 'connecting',
    app: null,
    paths: null,
    settings: null,
    instances: [],
    accounts: [],
    javaRuntimes: [],
    sessions: [],
    tasks: [],
    notices: [],
  })
  clearNotices()
})

describe('applyEvent', () => {
  it('adds a task to the front of the list', () => {
    useAppStore.getState().applyEvent({ type: 'task', task: makeTask('a') })
    expect(useAppStore.getState().tasks.map((task) => task.id)).toEqual(['a'])
  })

  it('replaces an existing task instead of duplicating it', () => {
    const store = useAppStore.getState()
    store.applyEvent({ type: 'task', task: makeTask('a') })
    store.applyEvent({ type: 'task', task: makeTask('a', 'succeeded') })
    const tasks = useAppStore.getState().tasks
    expect(tasks).toHaveLength(1)
    expect(tasks[0].status).toBe('succeeded')
  })

  it('caps the task list at 50 entries', () => {
    for (let index = 0; index < 60; index += 1) {
      useAppStore.getState().applyEvent({ type: 'task', task: makeTask('t' + index) })
    }
    expect(useAppStore.getState().tasks).toHaveLength(50)
    expect(useAppStore.getState().tasks[0].id).toBe('t59')
  })

  it('adds a new instance and keeps the list ordered by creation', () => {
    const store = useAppStore.getState()
    store.applyEvent({ type: 'instance', instance: makeInstance({ id: 'b', createdAt: 2 }) })
    store.applyEvent({ type: 'instance', instance: makeInstance({ id: 'a', createdAt: 1 }) })
    expect(useAppStore.getState().instances.map((item) => item.id)).toEqual(['a', 'b'])
  })

  it('updates an existing instance in place', () => {
    const store = useAppStore.getState()
    store.applyEvent({ type: 'instance', instance: makeInstance() })
    store.applyEvent({ type: 'instance', instance: makeInstance({ name: '改名了' }) })
    expect(useAppStore.getState().instances).toHaveLength(1)
    expect(useAppStore.getState().instances[0].name).toBe('改名了')
  })

  it('removes instances', () => {
    const store = useAppStore.getState()
    store.applyEvent({ type: 'instance', instance: makeInstance() })
    store.applyEvent({ type: 'instance-removed', id: 'i1' })
    expect(useAppStore.getState().instances).toEqual([])
  })

  it('tracks launch sessions and their exit codes', () => {
    const store = useAppStore.getState()
    store.applyEvent({ type: 'launch', session: makeSession('s1') })
    expect(useAppStore.getState().sessions[0].status).toBe('running')

    store.applyEvent({ type: 'launch-exit', sessionId: 's1', exitCode: 0, status: 'exited' })
    const session = useAppStore.getState().sessions[0]
    expect(session.status).toBe('exited')
    expect(session.exitCode).toBe(0)
    expect(session.endedAt).toBeTypeOf('number')
  })

  it('replaces sessions on a launch event', () => {
    const store = useAppStore.getState()
    store.applyEvent({ type: 'launch', session: makeSession('s1') })
    store.applyEvent({ type: 'launch', session: makeSession('s1', 'starting') })
    expect(useAppStore.getState().sessions).toHaveLength(1)
    expect(useAppStore.getState().sessions[0].status).toBe('starting')
  })

  it('applies settings snapshots', () => {
    const settings = useAppStore.getState().settings
    expect(settings).toBeNull()
    useAppStore.getState().applyEvent({
      type: 'settings',
      settings: {
        language: 'en-US',
        dataDir: null,
        concurrency: 4,
        mirrors: {
          versionManifest: '', launcherMeta: '', assets: '', maven: '',
          fabric: '', forge: '', neoforge: '', quilt: '', modrinth: '', curseforge: '',
        },
        autoDownloadJava: true,
        keepLogs: 5,
        showSnapshots: false,
        downloadSource: 'official',
        theme: 'midnight',
      },
    })
    expect(useAppStore.getState().settings?.theme).toBe('midnight')
  })

  it('buffers notices newest first and caps them at 50', () => {
    for (let index = 0; index < 60; index += 1) {
      useAppStore.getState().applyEvent({ type: 'notice', level: 'info', message: 'msg ' + index })
    }
    const notices = useAppStore.getState().notices
    expect(notices).toHaveLength(50)
    expect(notices[0].message).toBe('msg 59')
    expect(currentNotices().length).toBe(50)
  })

  it('mirrors notices into the standalone queue', () => {
    useAppStore.getState().applyEvent({ type: 'notice', level: 'warn', message: '小心' })
    expect(currentNotices()[0].message).toBe('小心')
    expect(currentNotices()[0].level).toBe('warn')
  })

  it('ignores unknown events without throwing', () => {
    expect(() =>
      useAppStore.getState().applyEvent({ type: 'launch-log', sessionId: 's1', lines: [] } as ServerEvent),
    ).not.toThrow()
  })
})

describe('notice queue', () => {
  it('keeps only the most recent entries', () => {
    for (let index = 0; index < 80; index += 1) pushNotice('info', 'n' + index)
    expect(currentNotices().length).toBe(50)
    expect(currentNotices()[currentNotices().length - 1].message).toBe('n79')
  })

  it('clears', () => {
    pushNotice('error', 'boom')
    clearNotices()
    expect(currentNotices()).toEqual([])
  })
})

describe('reload without a backend', () => {
  it('lands in the error state instead of throwing', async () => {
    await useAppStore.getState().reload()
    const state = useAppStore.getState()
    expect(state.status).toBe('error')
    expect(state.connection).toBe('offline')
    expect(state.error).toBeTruthy()
  })

  it('recovers when a retry succeeds', async () => {
    await useAppStore.getState().reload()
    expect(useAppStore.getState().status).toBe('error')

    // Simulate the backend coming back by stubbing the module-level fetch for
    // one call: this is the only place a mock is used, and it stands in for a
    // real server that is simply not running inside the test runner.
    const original = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        app: { name: 'Rhine', version: '0.1.0', pid: 1, platform: 'win32' },
        paths: { root: '/r', instances: '/r/i', assets: '/r/a', libraries: '/r/l', java: '/r/j', logs: '/r/g' },
        settings: null,
        instances: [],
        accounts: [],
        javaRuntimes: [],
        sessions: [],
        tasks: [],
      }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch
    try {
      await useAppStore.getState().reload()
    } finally {
      globalThis.fetch = original
    }
    expect(useAppStore.getState().status).toBe('ready')
    expect(useAppStore.getState().app?.version).toBe('0.1.0')
  })
})

describe('selectors', () => {
  it('activeSessions keeps only live sessions', () => {
    expect(
      activeSessions([
        makeSession('a', 'running'),
        makeSession('b', 'starting'),
        makeSession('c', 'exited'),
        makeSession('d', 'crashed'),
      ]).map((session) => session.id),
    ).toEqual(['a', 'b'])
  })

  it('formatBytes covers every unit', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(-5)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(1024 * 1024 * 3)).toBe('3.0 MB')
    expect(formatBytes(1024 ** 3 * 2.5)).toBe('2.5 GB')
  })
})
