import { useState } from 'react'
import { MapPin } from 'lucide-react'
import { Button } from '../../../components/ui/button'
import { Sheet } from '../../../components/ui/sheet'
import { LocationChoices } from './choices'
import type { LocationSelection } from './api'

export function LocationFilter({
  filters,
  onSelect,
}: {
  filters: Record<string, string>
  onSelect: (value: LocationSelection) => void
}) {
  const [open, setOpen] = useState(false)
  const mode = filters.location_mode
  const selected =
    mode === 'all' || mode === 'unassigned' || mode === 'named'
      ? ({ mode, location: filters.location } as LocationSelection)
      : undefined
  return (
    <Sheet
      title="按收纳位置找衣服"
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button
          variant="outline"
          className="wardrobe-location-trigger"
          aria-label="按收纳位置找衣服"
          aria-pressed={!!selected}
        >
          <MapPin size={16} aria-hidden="true" />
          位置
        </Button>
      }
    >
      {open && (
        <LocationChoices
          filters={filters}
          selected={selected}
          onSelect={(value) => {
            onSelect(value)
            setOpen(false)
          }}
        />
      )}
    </Sheet>
  )
}
