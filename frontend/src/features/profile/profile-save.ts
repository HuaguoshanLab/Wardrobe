import { z } from 'zod'
import { api } from '../../lib/http'
import { operationId } from '../../lib/id'

const storageKey = (path: string) => `wardrobe.save.${path}`
const operationSchema = z.object({ signature: z.string(), key: z.string().min(1) })
export type PendingSave = z.infer<typeof operationSchema>

export function readProfileSave(path: string): PendingSave | null {
  try {
    return operationSchema.parse(JSON.parse(localStorage.getItem(storageKey(path)) ?? 'null'))
  } catch {
    return null
  }
}

export function restoreProfileSave<T>(path: string, schema: z.ZodType<T>) {
  try {
    const operation = readProfileSave(path)
    if (!operation) return null
    return { ...operation, payload: schema.parse(JSON.parse(operation.signature)) }
  } catch {
    return null
  }
}

export function discardProfileSave(path: string) {
  localStorage.removeItem(storageKey(path))
}

// Replay the original bytes and key; a newer server version must not change this request.
export async function retryProfileSave<T>(
  path: string,
  schema: z.ZodType<T>,
  pending: PendingSave,
) {
  const result = await api(path, schema, {
    method: 'PATCH',
    headers: { 'Idempotency-Key': pending.key },
    body: pending.signature,
  })
  const current = readProfileSave(path)
  if (current?.key === pending.key && current.signature === pending.signature) {
    discardProfileSave(path)
  }
  return result
}

export async function saveProfile<T>(path: string, schema: z.ZodType<T>, payload: object) {
  const signature = JSON.stringify(payload)
  const previous = readProfileSave(path)
  const pending = {
    signature,
    key: previous?.signature === signature ? previous.key : operationId(),
  }
  localStorage.setItem(storageKey(path), JSON.stringify(pending))
  return retryProfileSave(path, schema, pending)
}
