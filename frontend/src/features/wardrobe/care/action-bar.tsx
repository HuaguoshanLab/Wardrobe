import { useRef } from 'react'
import { Button } from '../../../components/ui/button'
import { Sheet } from '../../../components/ui/sheet'
import type { Garment } from '../api'
import { actions, type CareBatch } from './api'
import type { CareDraft } from './state'
import { CareConfirmation } from './confirmation'

export function CareActionBar({
  draft,
  tags,
  busy,
  canConfirm,
  confirming,
  onOpenChange,
  onEdit,
  onConfirm,
}: {
  draft: CareDraft
  tags: { id: string; name: string }[]
  busy: boolean
  canConfirm: boolean
  confirming: boolean
  onOpenChange: (open: boolean) => void
  onEdit: () => void
  onConfirm: (body: CareBatch, selected: Garment[]) => void
}) {
  const submitted = useRef(false)
  const trigger = useRef<HTMLButtonElement>(null)
  return (
    <div className="care-action-bar" role="region" aria-label="本次批量操作">
      <div className="care-action-summary">
        <strong>已选 {draft.selected.length} / 20 件</strong>
        <span>{actions[draft.action]}</span>
      </div>
      <div className="care-action-buttons">
        <Button variant="outline" disabled={busy} onClick={onEdit}>
          更改操作
        </Button>
        <Sheet
          title="核对本次批量操作"
          open={confirming}
          onOpenChange={(value) => {
            if (value) submitted.current = false
            onOpenChange(value)
          }}
          finalFocus={() => {
            if (!submitted.current) return trigger.current
            // Base UI otherwise chooses the first tabbable child of this summary.
            // Focus the result itself so the outcome precedes its retry actions.
            document.querySelector<HTMLElement>('.care-feedback')?.focus({ preventScroll: true })
            return false
          }}
          trigger={
            <Button ref={trigger} disabled={!canConfirm}>
              核对并继续
            </Button>
          }
        >
          {confirming && (
            <CareConfirmation
              draft={draft}
              tags={tags}
              busy={busy}
              onConfirm={(body, selected) => {
                submitted.current = true
                onConfirm(body, selected)
              }}
            />
          )}
        </Sheet>
      </div>
    </div>
  )
}
