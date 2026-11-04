import { useId, useRef, useState } from 'react'
import { Button } from '../../../components/ui/button'
import { LocationChoices } from './choices'

export function LocationInput({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const choicesId = useId()
  const [notice, setNotice] = useState('')
  const returnToInput = () => {
    setOpen(false)
    input.current?.focus()
  }
  return (
    <div className="location-input">
      <label>
        {label}
        <input
          ref={input}
          maxLength={120}
          value={value}
          disabled={disabled}
          placeholder="例如：衣柜第二层"
          onChange={(e) => {
            setNotice('')
            onChange(e.target.value)
          }}
        />
      </label>
      <Button
        variant="outline"
        disabled={disabled}
        aria-expanded={open}
        aria-controls={choicesId}
        onClick={() => {
          setNotice('')
          setOpen(!open)
        }}
      >
        {open ? '收起已有位置' : '选择已有位置'}
      </Button>
      {notice && (
        <p role="status" className="location-help">
          {notice}
        </p>
      )}
      {open && (
        <div id={choicesId} className="location-suggestions">
          <LocationChoices
            reuse
            disabled={disabled}
            onDismiss={returnToInput}
            selected={{ mode: 'named', location: value.trim() }}
            onSelect={(next) => {
              if (disabled || !next.location) return
              onChange(next.location)
              setNotice('已填入位置，保存后生效。')
              returnToInput()
            }}
          />
        </div>
      )}
    </div>
  )
}
