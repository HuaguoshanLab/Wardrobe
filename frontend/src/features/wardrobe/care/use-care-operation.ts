import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { garmentSchema, type Garment } from '../api'
import { ApiError } from '../../../lib/http'
import { operationId } from '../../../lib/id'
import { batchSchema, resultSchema, saveCare, type CareBatch } from './api'
import { readStored } from './state'

const pendingSchema = z.object({
  key: z.string(),
  body: batchSchema,
  selected: z.array(garmentSchema),
})
const savedSchema = z.object({
  body: batchSchema,
  result: resultSchema,
  selected: z.array(garmentSchema),
})
export type SavedCare = z.infer<typeof savedSchema>
const pendingKey = 'wardrobe.care.pending',
  resultKey = 'wardrobe.care.result'
export function useCareOperation(onComplete: (failed: Garment[]) => void) {
  const client = useQueryClient()
  const [pending, setPending] = useState(() => readStored(pendingKey, pendingSchema))
  const [saved, setSaved] = useState(() => readStored(resultKey, savedSchema))
  const mutation = useMutation({
    mutationFn: async (op: z.infer<typeof pendingSchema>) => {
      // Persist the original body and key before sending; no effects resend it.
      localStorage.setItem(pendingKey, JSON.stringify(op))
      setPending(op)
      const result = await saveCare(op.body, op.key)
      const completed = { body: op.body, result, selected: op.selected }
      localStorage.setItem(resultKey, JSON.stringify(completed))
      localStorage.removeItem(pendingKey)
      return completed
    },
    onSuccess: (completed) => {
      setPending(null)
      setSaved(completed)
      const failed = new Set(
        completed.result.items.filter((i) => !i.success).map((i) => i.garment_id),
      )
      onComplete(completed.selected.filter((g) => failed.has(g.id)))
      void client.invalidateQueries()
    },
  })
  const rejected =
    mutation.error instanceof ApiError && [400, 409, 422].includes(mutation.error.status)
  return {
    rejected,
    editRejected: () => {
      if (rejected && !mutation.isPending) {
        localStorage.removeItem(pendingKey)
        setPending(null)
        mutation.reset()
      }
    },
    pending,
    saved,
    busy: mutation.isPending || !!pending,
    sending: mutation.isPending,
    error: mutation.error,
    send: (body: CareBatch, selected: Garment[]) => {
      if (!pending && !mutation.isPending) mutation.mutate({ body, selected, key: operationId() })
    },
    resend: () => {
      if (pending && !mutation.isPending) mutation.mutate(pending)
    },
    dismiss: () => {
      localStorage.removeItem(resultKey)
      setSaved(null)
    },
  }
}
export type CareOperation = ReturnType<typeof useCareOperation>
