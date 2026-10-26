export function Choices({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: Record<string, string>
  value: string[]
  onChange: (value: string[]) => void
}) {
  return (
    <fieldset className="choice-field">
      <legend>{label}</legend>
      <div className="choice-list">
        {Object.entries(options).map(([code, name]) => (
          <label key={code}>
            <input
              type="checkbox"
              checked={value.includes(code)}
              onChange={(event) =>
                onChange(
                  event.target.checked ? [...value, code] : value.filter((item) => item !== code),
                )
              }
            />
            {name}
          </label>
        ))}
      </div>
    </fieldset>
  )
}
