import { useState } from 'react'
import { Button } from '../../components/ui/button'
import type { OutfitController } from './use-outfits'

export function OutfitChat({
  controller: c,
  sessionId,
  onAccepted,
}: {
  controller: OutfitController
  sessionId: string
  onAccepted?: () => void
}) {
  const key = `wardrobe.outfit.chat.${sessionId}`
  const [message, setMessage] = useState(() => {
    try {
      return localStorage.getItem(key) ?? ''
    } catch {
      return ''
    }
  })
  return (
    <form
      className="attribute-form"
      onSubmit={async (e) => {
        e.preventDefault()
        if (await c.adjust('chat', [], message)) {
          setMessage('')
          localStorage.removeItem(key)
          onAccepted?.()
        }
      }}
    >
      <label>
        聊天调整要求
        <textarea
          maxLength={1000}
          value={message}
          onChange={(e) => {
            setMessage(e.target.value)
            localStorage.setItem(key, e.target.value)
          }}
          placeholder="例如：只换裤子，其他保持"
        />
      </label>
      <Button type="submit" disabled={c.busy || !message.trim()}>
        发送调整要求
      </Button>
    </form>
  )
}
