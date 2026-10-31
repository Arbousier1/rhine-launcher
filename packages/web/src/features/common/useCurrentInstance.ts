/**
 * The "currently inspected archive" selection.
 *
 * The shell owns the instance list, but it does not own a selection: the mods,
 * market and logs pages all need to know which instance they are working on.
 * Keeping the selection here (persisted in localStorage) means every page agrees
 * without adding global state that would duplicate `useAppStore`.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Instance } from '@rhine/core'
import { useAppStore } from '@/stores'

const SELECTION_KEY = 'rhine.currentInstance'
const EVENT = 'rhine:instance-selection'

function read(): string | null {
  try {
    return localStorage.getItem(SELECTION_KEY)
  } catch {
    return null
  }
}

function write(id: string | null): void {
  try {
    if (id) localStorage.setItem(SELECTION_KEY, id)
    else localStorage.removeItem(SELECTION_KEY)
  } catch {
    // Storage disabled: the selection only lives for this page view.
  }
  window.dispatchEvent(new CustomEvent<string | null>(EVENT, { detail: id }))
}

/**
 * Resolve the instance a page should operate on.
 *
 * @param explicit — instance id handed down by the shell (route param); wins
 *   over the persisted selection.
 * @returns the resolved instance plus a setter used by the page's picker.
 */
export function useCurrentInstance(explicit?: string): {
  instances: Instance[]
  instance: Instance | undefined
  instanceId: string | undefined
  select: (id: string) => void
} {
  const instances = useAppStore((state) => state.instances)
  const [stored, setStored] = useState<string | null>(() => read())

  useEffect(() => {
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<string | null>).detail
      setStored(detail ?? null)
    }
    window.addEventListener(EVENT, onChange)
    return () => window.removeEventListener(EVENT, onChange)
  }, [])

  // A deleted instance must not stay selected.
  useEffect(() => {
    if (stored && instances.length > 0 && !instances.some((item) => item.id === stored)) {
      write(null)
      setStored(null)
    }
  }, [instances, stored])

  const instance = useMemo(() => {
    if (explicit) return instances.find((item) => item.id === explicit)
    return instances.find((item) => item.id === stored) ?? instances[0]
  }, [explicit, instances, stored])

  const select = useCallback((id: string) => {
    write(id)
    setStored(id)
  }, [])

  return { instances, instance, instanceId: instance?.id, select }
}

/** Option list for an instance picker, newest first. */
export function instanceOptions(instances: Instance[]): { value: string; label: string }[] {
  return instances.map((instance) => ({
    value: instance.id,
    label: instance.name + ' · ' + instance.gameVersion,
  }))
}
