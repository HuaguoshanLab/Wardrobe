import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { api } from './http'
import { operationId } from './id'

const operationSchema = z.object({
  path: z.string(),
  method: z.enum(['POST', 'PATCH', 'DELETE']),
  body: z.json().optional(),
  version: z.number().optional(),
  key: z.string(),
})
type Operation = z.infer<typeof operationSchema>
export function useOperation(
  namespace: string,
  onSuccess?: (value: z.infer<ReturnType<typeof z.json>>, path: string) => void,
) {
  const storageKey = `wardrobe.${namespace}.pending`
  const client = useQueryClient()
  const [pending, setPending] = useState<Operation | null>(() => {
    try {
      return operationSchema.parse(JSON.parse(localStorage.getItem(storageKey) ?? 'null'))
    } catch {
      return null
    }
  })
  const [notice, setNotice] = useState('')
  const mutation = useMutation({
    mutationFn: async (op: Operation) => {
      localStorage.setItem(storageKey, JSON.stringify(op))
      setPending(op)
      const value = await api(op.path, z.json(), {
        method: op.method,
        headers: {
          'Idempotency-Key': op.key,
          ...(op.version ? { 'If-Match': String(op.version) } : {}),
        },
        body: op.body === undefined ? undefined : JSON.stringify(op.body),
      })
      localStorage.removeItem(storageKey)
      setPending(null)
      setNotice('操作已保存。')
      await client.invalidateQueries()
      onSuccess?.(value, op.path)
      return value
    },
  })
  return {
    pending,
    notice,
    error: mutation.error,
    busy: mutation.isPending || !!pending,
    sending: mutation.isPending,
    send: (
      path: string,
      method: Operation['method'],
      body?: Operation['body'],
      version?: number,
    ) => {
      if (pending || mutation.isPending) return
      mutation.mutate({ path, method, body, version, key: operationId() })
    },
    resend: () => pending && !mutation.isPending && mutation.mutate(pending),
    discard: () => {
      localStorage.removeItem(storageKey)
      setPending(null)
      mutation.reset()
      void client.invalidateQueries()
    },
  }
}
export type OperationController = ReturnType<typeof useOperation>
