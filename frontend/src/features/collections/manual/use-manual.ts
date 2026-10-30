import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { api, ApiError } from '../../../lib/http'
import { operationId } from '../../../lib/id'
import {
  draftSchema,
  emptyDraft,
  fromParent,
  pendingSchema,
  refreshItems,
  resultSchema,
  type Draft,
  type ManualInput,
  type ManualResult,
} from './state'

export function useManual(parent: string, initialDate: string) {
  const namespace = `wardrobe.manual.${parent || 'new'}`
  const client = useQueryClient()
  const initial = useRef(false)
  const [draft, setDraft] = useState<Draft>(() => {
    try {
      const stored = localStorage.getItem(`${namespace}.draft`)
      if (stored) {
        initial.current = true
        return draftSchema.parse(JSON.parse(stored))
      }
    } catch {
      /* Invalid local draft cannot become a request. */
    }
    return { ...emptyDraft(), ...(initialDate ? { mode: 'wear', date: initialDate } : {}) }
  })
  const [pending, setPending] = useState<z.infer<typeof pendingSchema> | null>(() => {
    try {
      return pendingSchema.parse(JSON.parse(localStorage.getItem(`${namespace}.pending`) || 'null'))
    } catch {
      return null
    }
  })
  const [ready, setReady] = useState(!parent || initial.current)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [result, setResult] = useState<ManualResult | null>(null)
  const loadParent = async () => {
    setError('')
    setRefreshing(true)
    try {
      setDraft(await fromParent(parent))
      setReady(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : '读取失败')
    } finally {
      setRefreshing(false)
    }
  }
  useEffect(() => {
    if (ready) return
    let active = true
    void fromParent(parent)
      .then((value) => {
        if (active) {
          setDraft(value)
          setReady(true)
        }
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : '读取失败')
      })
    return () => {
      active = false
    }
  }, [parent, ready])
  useEffect(() => {
    if (ready && !result) localStorage.setItem(`${namespace}.draft`, JSON.stringify(draft))
  }, [draft, namespace, ready, result])
  const mutation = useMutation({
    mutationFn: (op: z.infer<typeof pendingSchema>) =>
      api('/manual-outfits', resultSchema, {
        method: 'POST',
        headers: { 'Idempotency-Key': op.key },
        body: JSON.stringify(op.body),
      }),
    onSuccess: (value) => {
      localStorage.removeItem(`${namespace}.pending`)
      localStorage.removeItem(`${namespace}.draft`)
      setPending(null)
      setResult(value)
      void client.invalidateQueries()
    },
  })
  const refresh = async () => {
    if (mutation.isPending) return
    setRefreshing(true)
    setError('')
    try {
      const items = await refreshItems(draft.items)
      setDraft((d) => ({ ...d, items, acknowledged: false }))
      if (
        pending &&
        mutation.error instanceof ApiError &&
        [409, 422].includes(mutation.error.status)
      ) {
        localStorage.removeItem(`${namespace}.pending`)
        setPending(null)
        mutation.reset()
      }
    } finally {
      setRefreshing(false)
    }
  }
  return {
    draft,
    setDraft,
    ready,
    error,
    result,
    refresh,
    loadParent,
    pending,
    sending: mutation.isPending,
    busy: mutation.isPending || !!pending || refreshing,
    refreshing,
    saveError: mutation.error,
    canCorrect: mutation.error instanceof ApiError && [409, 422].includes(mutation.error.status),
    resend: () => pending && !mutation.isPending && mutation.mutate(pending),
    submit: (body: ManualInput) => {
      if (pending || mutation.isPending) return
      const op = { key: operationId(), body: z.json().parse(body) }
      localStorage.setItem(`${namespace}.pending`, JSON.stringify(op))
      setPending(op)
      mutation.mutate(op)
    },
  }
}
