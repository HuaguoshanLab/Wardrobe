export function Choices({
  label,
  options,
  selected,
  onChange,
  disabled = false,
}: {
  label: string
  options: Record<string, string>
  selected: string[]
  onChange: (value: string) => void
  disabled?: boolean
}) {
  return (
    <fieldset className="wardrobe-choice-group" disabled={disabled}>
      <legend>{label}</legend>
      <div className="wardrobe-chips" data-multiple={label.includes('可多选')}>
        {Object.entries(options).map(([value, name]) => (
          <button
            type="button"
            key={value}
            aria-pressed={selected.includes(value)}
            onClick={() => onChange(value)}
          >
            {name}
          </button>
        ))}
      </div>
    </fieldset>
  )
}
