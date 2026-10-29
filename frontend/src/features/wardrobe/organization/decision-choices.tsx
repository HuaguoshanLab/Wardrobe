const choices = [
  { value: 'observe', label: '继续观察', hint: '暂时不作处理，留待以后复核。' },
  { value: 'keep', label: '继续保留', hint: '留下这件，不再重复提醒同一原因。' },
  { value: 'pending', label: '列为待处理', hint: '先记入待办，仍保留在衣橱中。' },
  { value: 'undecided', label: '撤销这一原因的决定', hint: '清除这项决定，重新评估。' },
]
export function DecisionChoices({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="organization-choices" role="radiogroup" aria-label="整理决定">
      {choices.map((c) => (
        <label className="organization-choice" key={c.value} data-selected={value === c.value}>
          <input
            type="radio"
            name="organization-decision"
            value={c.value}
            checked={value === c.value}
            onChange={() => onChange(c.value)}
          />
          <span>
            <strong>{c.label}</strong>
            <small>{c.hint}</small>
          </span>
        </label>
      ))}
    </div>
  )
}
