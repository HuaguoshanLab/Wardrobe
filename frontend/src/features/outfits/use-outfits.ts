import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { useNavigate } from 'react-router'
import { api } from '../../lib/http'
import { operationId } from '../../lib/id'
import { subscribe } from '../../lib/sse'
import type { Requirements } from '../profile'
import {
  acceptedSchema,
  getCurrent,
  getSession,
  getJob,
  isTerminal,
  outfitJobSchema,
  sessionSchema,
} from './api'

const pendingKey = 'wardrobe.outfit.pending'
const pendingSchema = z.object({
  path: z.string(),
  method: z.enum(['POST', 'PATCH']),
  body: z.record(z.string(), z.json()),
  key: z.string(),
  generateAfter: z.boolean(),
})
type Pending = z.infer<typeof pendingSchema>
function readPending() {
  try {
    return pendingSchema.parse(JSON.parse(localStorage.getItem(pendingKey) ?? 'null'))
  } catch {
    return null
  }
}
export function useOutfits(sessionId?: string, returnToResults = false) {
  const navigate = useNavigate()
  const client = useQueryClient()
  const [pending, setPending] = useState(readPending)
  const [notice, setNotice] = useState('')
  const cursor = useRef({ id: '', seq: 0 })
  const session = useQuery({
    queryKey: ['outfits', sessionId ?? 'current'],
    queryFn: () => (sessionId ? getSession(sessionId) : getCurrent()),
    refetchInterval: 3000,
  })
  const id = session.data?.current_job_id
  const job = useQuery({
    queryKey: ['outfit-job', id],
    enabled: !!id,
    queryFn: () => getJob(id!),
    refetchInterval: (q) => (isTerminal(q.state.data?.status) ? false : 1200),
  })
  const store = (value: Pending | null) => {
    if (value) localStorage.setItem(pendingKey, JSON.stringify(value))
    else localStorage.removeItem(pendingKey)
    setPending(value)
  }
  const submit = useMutation({
    mutationFn: async (first: Pending) => {
      let operation = first
      for (;;) {
        store(operation)
        const returnsSession = operation.path === '/outfit-sessions' || operation.method === 'PATCH'
        const init = {
          method: operation.method,
          headers: { 'Idempotency-Key': operation.key },
          body: JSON.stringify(operation.body),
        }
        if (returnsSession) {
          const value = await api(operation.path, sessionSchema, init)
          client.setQueryData(['outfits', sessionId ?? 'current'], value)
          if (operation.path === '/outfit-sessions' && sessionId && !operation.generateAfter)
            navigate(`/outfits/${value.id}${returnToResults ? '/prepare' : ''}`)
          if (value.removed_lock_ids.length) setNotice('切换方案时已移除不共有或失效的锁定。')
          if (operation.generateAfter) {
            operation = {
              path: `/outfit-sessions/${value.id}/generate`,
              method: 'POST',
              body: { expected_version: value.version },
              key: operationId(),
              generateAfter: false,
            }
            continue
          }
        } else {
          await api(operation.path, acceptedSchema, init)
        }
        store(null)
        await client.invalidateQueries({ queryKey: ['outfits'] })
        const generatedSession = operation.path.match(/^\/outfit-sessions\/([^/]+)\/generate$/)?.[1]
        if (returnToResults && generatedSession) navigate(`/outfits/${generatedSession}`)
        return
      }
    },
  })
  const active = !!id && (!job.data || !isTerminal(job.data.status))
  const busy = submit.isPending || active || !!pending || session.isPending
  useEffect(() => {
    if (!id || !job.data || isTerminal(job.data.status)) return
    if (cursor.current.id !== id) cursor.current = { id, seq: 0 }
    const controller = new AbortController()
    void subscribe(id, cursor.current.seq, controller.signal, (event) => {
      cursor.current.seq = event.seq
      if (typeof event.payload.message === 'string') setNotice(event.payload.message)
      void client.invalidateQueries({ queryKey: ['outfit-job', id] })
      void client.invalidateQueries({ queryKey: ['outfits'] })
    }).catch(() => {
      if (!controller.signal.aborted) setNotice('事件连接中断，正在只读查询任务恢复进度。')
    })
    return () => controller.abort()
  }, [id, job.data?.status, client])
  useEffect(() => {
    if (isTerminal(job.data?.status)) void client.invalidateQueries({ queryKey: ['outfits'] })
  }, [job.data?.status, client])
  const send = (
    path: string,
    method: 'POST' | 'PATCH',
    body: Record<string, z.infer<ReturnType<typeof z.json>>>,
    generateAfter = false,
  ) => {
    if (submit.isPending || pending) return
    submit.mutate({ path, method, body, key: operationId(), generateAfter })
  }
  const cancel = useMutation({
    mutationFn: () => api(`/jobs/${id}/cancel`, outfitJobSchema, { method: 'POST' }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['outfit-job', id] }),
  })
  return {
    session: session.data,
    loading: session.isPending,
    job: job.data,
    busy,
    active,
    pending,
    notice,
    cancel,
    error: submit.error ?? cancel.error ?? session.error ?? job.error,
    submitting: submit.isPending,
    resend: () => pending && !submit.isPending && submit.mutate(pending),
    discard: () => {
      store(null)
      submit.reset()
      void session.refetch()
    },
    generate: (requirements: Requirements) => {
      const current = session.data
      send(
        current ? `/outfit-sessions/${current.id}` : '/outfit-sessions',
        current ? 'PATCH' : 'POST',
        current ? { requirements, expected_version: current.version } : { requirements },
        true,
      )
    },
    newSession: () => send('/outfit-sessions', 'POST', {}),
    patch: (changes: Record<string, z.infer<ReturnType<typeof z.json>>>) =>
      session.data &&
      send(`/outfit-sessions/${session.data.id}`, 'PATCH', {
        expected_version: session.data.version,
        ...changes,
      }),
    adjust: (
      scope: 'replace_items' | 'rebuild_unlocked' | 'chat',
      targets: string[],
      message: string,
    ) =>
      session.data &&
      send(`/outfit-sessions/${session.data.id}/adjust`, 'POST', {
        expected_version: session.data.version,
        base_revision_id: session.data.selected_revision_id,
        scope,
        target_item_ids: targets,
        message,
      }),
    retry: () => id && send(`/jobs/${id}/retry`, 'POST', {}),
  }
}
export type OutfitController = ReturnType<typeof useOutfits>
