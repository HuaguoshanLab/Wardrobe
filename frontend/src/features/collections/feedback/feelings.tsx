import { Button } from '../../../components/ui/button'
import { labels, type Feedback } from './api'

const titles = { thermal: '冷热感受', comfort: '舒适度', color: '配色满意度' }
type Feeling = keyof typeof titles

export function FeedbackFeelings({
  data,
  onChange,
}: {
  data: Feedback
  onChange: <K extends Feeling>(key: K, value: Feedback[K]) => void
}) {
  return (
    <div className="feedback-feelings">
      {(Object.keys(titles) as Feeling[]).map((key) => (
        <fieldset className="feedback-choices" key={key}>
          <legend>{titles[key]}</legend>
          <div className="feedback-choice-status">
            <Button
              variant="outline"
              className="feedback-clear"
              aria-label={`清除${titles[key]}`}
              disabled={!data[key]}
              onClick={() => onChange(key, null)}
            >
              {data[key] ? '清除' : '未评价'}
            </Button>
          </div>
          <div className="feedback-choice-options">
            {Object.entries(labels[key]).map(([value, label]) => (
              <label key={value}>
                <input
                  type="radio"
                  name={key}
                  checked={data[key] === value}
                  onChange={() => onChange(key, value as Feedback[typeof key])}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ))}
    </div>
  )
}
