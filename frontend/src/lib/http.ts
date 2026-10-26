import { z } from 'zod'

const errorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) })

export async function api<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...init?.headers,
    },
  })
  const body: unknown = await response.json()
  if (!response.ok) {
    const parsed = errorSchema.safeParse(body)
    throw new Error(parsed.success ? parsed.data.error.message : `请求失败 (${response.status})`)
  }
  return z.object({ data: schema, request_id: z.uuid() }).parse(body).data
}
