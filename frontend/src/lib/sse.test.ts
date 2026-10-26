import { describe, expect, it, vi } from 'vitest'
import { subscribe } from './sse'

describe('SSE transport', () => {
  it('handles UTF-8 fragmentation and duplicate events', async () => {
    const id = '00000000-0000-4000-8000-000000000002'
    const event = {
      schema_version: 1,
      job_id: id,
      seq: 1,
      type: 'progress',
      occurred_at: '2026-10-26T00:00:00Z',
      payload: { message: '正在处理衣服' },
    }
    const frame = `id: 1\nevent: progress\ndata: ${JSON.stringify(event)}\n\n`
    const bytes = new TextEncoder().encode(frame + frame)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          new ReadableStream({
            start(controller) {
              for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3))
              controller.close()
            },
          }),
        ),
      ),
    )
    const onEvent = vi.fn()
    try {
      await subscribe(id, 0, new AbortController().signal, onEvent)
      expect(onEvent).toHaveBeenCalledTimes(1)
      expect(onEvent).toHaveBeenCalledWith(event)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
