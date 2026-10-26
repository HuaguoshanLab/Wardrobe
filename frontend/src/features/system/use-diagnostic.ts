import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { api } from '../../lib/http'
import { operationId } from '../../lib/id'
import { subscribe } from '../../lib/sse'
import { acceptedSchema, getJob, isTerminal, jobSchema } from './api'

const storageKey = 'wardrobe.diagnostic'
const storedSchema = z.object({
  key: z.string(),
  message: z.string(),
  jobId: z.string().optional(),
  retryOf: z.string().optional(),
})
type Operation = z.infer<typeof storedSchema>

function readStored(): Operation | null {
  try {
    return storedSchema.parse(JSON.parse(localStorage.getItem(storageKey) ?? 'null'))
  } catch {
    return null
  }
}

export function useDiagnostic() {
  const client = useQueryClient()
  const [operation, setOperation] = useState(readStored)
  const [streamMessage, setStreamMessage] = useState('')
  const cursor = useRef({ id: '', seq: 0 })
  const query = useQuery({
    queryKey: ['job', operation?.jobId],
    enabled: !!operation?.jobId,
    queryFn: () => getJob(operation!.jobId!),
    refetchInterval: (query) => (isTerminal(query.state.data?.status) ? false : 1500),
  })
  const save = (next: Operation) => {
    localStorage.setItem(storageKey, JSON.stringify(next))
    setOperation(next)
  }
  const submit = useMutation({
    mutationFn: async (next: Operation) => {
      save(next) // Persist before POST; ambiguous failures retain the same key.
      const path = next.retryOf ? `/jobs/${next.retryOf}/retry` : '/diagnostics/jobs'
      const result = await api(path, acceptedSchema, {
        method: 'POST',
        headers: { 'Idempotency-Key': next.key },
        ...(!next.retryOf
          ? { body: JSON.stringify({ message: next.message, delay_seconds: 2 }) }
          : {}),
      })
      save({ ...next, jobId: result.job_id })
      return result
    },
  })
  const cancel = useMutation({
    mutationFn: () => api(`/jobs/${operation!.jobId}/cancel`, jobSchema, { method: 'POST' }),
    onSuccess: (data) => client.setQueryData(['job', data.id], data),
  })
  useEffect(() => {
    const id = operation?.jobId
    if (!id || !query.data || isTerminal(query.data.status)) return
    if (cursor.current.id !== id) cursor.current = { id, seq: 0 }
    const controller = new AbortController()
    void subscribe(id, cursor.current.seq, controller.signal, (event) => {
      cursor.current.seq = event.seq
      if (typeof event.payload.message === 'string') setStreamMessage(event.payload.message)
      void client.invalidateQueries({ queryKey: ['job', id] })
    }).catch(() => {
      if (!controller.signal.aborted) {
        setStreamMessage('事件连接暂不可用，正在通过任务查询恢复。')
        void client.invalidateQueries({ queryKey: ['job', id] })
      }
    })
    return () => controller.abort()
  }, [operation?.jobId, query.data?.status, client])

  return {
    job: query.data,
    operation,
    streamMessage,
    cancel,
    error: submit.error ?? cancel.error ?? query.error,
    pending: submit.isPending || (!!operation?.jobId && !isTerminal(query.data?.status)),
    unresolved: !!operation && !operation.jobId,
    run: (message: string) => submit.mutate({ key: operationId(), message }),
    resend: () => operation && submit.mutate(operation),
    retry: () =>
      operation?.jobId &&
      submit.mutate({ key: operationId(), message: operation.message, retryOf: operation.jobId }),
  }
}
