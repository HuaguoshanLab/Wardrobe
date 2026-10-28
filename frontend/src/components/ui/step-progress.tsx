import './step-progress.css'
export function StepProgress({
  label,
  steps,
  current,
}: {
  label: string
  steps: string[]
  current: number
}) {
  return (
    <ol className="step-progress" aria-label={label}>
      {steps.map((step, index) => (
        <li key={step} aria-current={index === current ? 'step' : undefined}>
          <b>{index + 1}</b>
          <span>{step}</span>
        </li>
      ))}
    </ol>
  )
}
