import { createParser } from 'eventsource-parser'
import { z } from 'zod'
import type { components } from '../generated/api'

export const eventSchema = z.object({
  schema_version: z.literal(1),
  job_id: z.uuid(),
  seq: z.int().positive(),
  type: z.enum(['status', 'progress', 'result', 'error']),
  occurred_at: z.string(),
  payload: z.record(z.string(), z.json()),
}) satisfies z.ZodType<components['schemas']['EventView']>

export type JobEvent = z.infer<typeof eventSchema>

export async function subscribe(
  jobId: string,
  after: number,
  signal: AbortSignal,
  onEvent: (event: JobEvent) => void,
) {
  const response = await fetch(`/api/v1/jobs/${jobId}/events?after_seq=${after}`, { signal })
  if (!response.ok || !response.body) throw new Error(`事件连接失败 (${response.status})`)
  let seen = after
  const parser = createParser({
    onEvent: (message) => {
      if (message.event === 'stream_error') throw new Error('事件连接中断，请查询任务')
      const event = eventSchema.parse(JSON.parse(message.data))
      if (event.job_id !== jobId || message.id !== String(event.seq))
        throw new Error('事件标识不一致')
      if (event.seq <= seen) return
      seen = event.seq
      onEvent(event)
    },
  })
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      parser.feed(decoder.decode(value, { stream: true }))
    }
    parser.feed(decoder.decode())
  } finally {
    await reader.cancel()
    reader.releaseLock()
  }
}
