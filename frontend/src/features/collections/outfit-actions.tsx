import { useState } from 'react'
import { createPortal } from 'react-dom'
import { CalendarCheck, Heart, Check } from 'lucide-react'
import { Sheet } from '../../components/ui/sheet'
import { Button } from '../../components/ui/button'
import { OperationNotice } from '../../components/ui/operation-notice'
import { useOperation } from '../../lib/use-operation'
import type { Revision } from '../outfits'
import { today } from './api'

/** Kept on the lookbook so saving never loses the preview or its scroll position. */
export function OutfitActions({
  revision,
  feedbackContainer,
}: {
  revision: Revision
  feedbackContainer?: HTMLElement | null
}) {
  const [open, setOpen] = useState<'favorite' | 'wear' | null>(null)
  const [name, setName] = useState('')
  const [date, setDate] = useState(today)
  const [notes, setNotes] = useState('')
  const [saved, setSaved] = useState('')
  const [favorited, setFavorited] = useState(false)
  const op = useOperation(`lookbook.${revision.id}`, (_, path) => {
    if (path === '/favorites') setFavorited(true)
    setSaved(path === '/favorites' ? '已收藏这套搭配' : '穿着记录已保存')
    setOpen(null)
  })
  const photos = revision.items.filter((item) => item.image_url)
  const feedback = (
    <>
      {saved && (
        <p className="save-feedback" role="status">
          <Check size={16} aria-hidden="true" />
          {saved}
        </p>
      )}
      {op.pending && !open && <OperationNotice operation={{ ...op, notice: '' }} />}
    </>
  )
  return (
    <div className="outfit-save-actions">
      <Sheet
        title="收藏这套"
        open={open === 'favorite'}
        onOpenChange={(value) => setOpen(value ? 'favorite' : null)}
        trigger={
          <button className="lookbook-utility">
            <Heart size={18} aria-hidden="true" fill={favorited ? 'currentColor' : 'none'} />
            {favorited ? '已收藏' : '收藏'}
          </button>
        }
      >
        <p className="muted">留住这套灵感，以后在「穿搭记录」中找到它。</p>
        <form
          className="attribute-form"
          onSubmit={(e) => {
            e.preventDefault()
            op.send('/favorites', 'POST', { revision_id: revision.id, name })
          }}
        >
          <label>
            收藏名称（选填）
            <input
              value={name}
              maxLength={100}
              placeholder="给这套搭配起个名字"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <Button type="submit" disabled={op.busy}>
            {op.sending ? '正在收藏…' : '确认收藏'}
          </Button>
        </form>
        <OperationNotice operation={{ ...op, notice: '' }} />
      </Sheet>
      <Sheet
        title="记录穿着"
        open={open === 'wear'}
        onOpenChange={(value) => setOpen(value ? 'wear' : null)}
        trigger={
          <button className="lookbook-utility">
            <CalendarCheck size={18} aria-hidden="true" />
            记录穿着
          </button>
        }
      >
        <div className="record-preview">
          {photos.map((item) => (
            <img
              key={item.item_id}
              src={item.image_url!}
              alt={String(item.attributes.name || '搭配单品')}
            />
          ))}
        </div>
        <p className="muted">记下实际穿过的这套搭配。收藏和选用不会自动记入日历。</p>
        <form
          className="attribute-form"
          onSubmit={(e) => {
            e.preventDefault()
            op.send('/wear-records', 'POST', { revision_id: revision.id, worn_on: date, notes })
          }}
        >
          <label>
            实际穿着日期
            <input
              type="date"
              required
              max={today()}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label>
            穿着备注（选填）
            <textarea
              value={notes}
              maxLength={1000}
              placeholder="今天穿起来感觉怎么样？"
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
          <Button type="submit" disabled={op.busy || !date || date > today()}>
            {op.sending ? '正在保存…' : '确认记录穿着'}
          </Button>
        </form>
        <OperationNotice operation={{ ...op, notice: '' }} />
      </Sheet>
      {feedbackContainer ? createPortal(feedback, feedbackContainer) : feedback}
    </div>
  )
}
