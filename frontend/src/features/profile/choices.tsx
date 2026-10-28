const colors: Record<string, string> = {
  black: '#303532',
  white: '#fff',
  gray: '#9ca29d',
  beige: '#e6dac3',
  brown: '#8e6651',
  blue: '#6c8fb5',
  green: '#719578',
  red: '#b95c56',
  pink: '#dfaaaa',
  yellow: '#e5c666',
  orange: '#da975c',
  purple: '#a28bab',
  silver: '#b9c2c1',
  gold: '#bfa161',
  multicolor: 'linear-gradient(135deg,#759781,#e9c47c,#bc8888)',
}

export function Choices({
  label,
  options,
  value,
  onChange,
  swatches = false,
}: {
  swatches?: boolean
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
            {swatches && colors[code] && (
              <span
                aria-hidden="true"
                className="preference-swatch"
                style={{ background: colors[code] }}
              />
            )}
            {name}
          </label>
        ))}
      </div>
    </fieldset>
  )
}
