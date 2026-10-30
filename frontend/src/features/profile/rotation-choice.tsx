import { useId } from 'react'
import type { Requirements } from './api'
import './rotation-choice.css'

const options = [
  {
    mode: 'normal',
    label: '正常推荐',
    window: '按条件',
    hint: '按场合和偏好搭配',
    detail: '不参考穿着记录，按本次条件与偏好推荐。',
  },
  {
    mode: 'avoid_recent',
    label: '尽量避开近期组合',
    window: '近 7 天',
    hint: '给主体穿搭换个组合',
    detail: '参考近 7 天的实际记录；只换鞋包，不算主体组合变化。',
  },
  {
    mode: 'less_worn',
    label: '优先近期少穿',
    window: '近 30 天',
    hint: '让记录较少的单品参与',
    detail: '参考近 30 天的记录天数；无记录不代表从未穿过。',
  },
] as const

export function RotationChoice({
  value,
  onChange,
}: {
  value: Requirements['rotation_mode']
  onChange: (mode: Requirements['rotation_mode']) => void
}) {
  const helpId = useId()
  return (
    <fieldset className="rotation-choice" aria-describedby={helpId}>
      <legend>穿搭轮换</legend>
      <p className="rotation-choice-intro">今天想照常搭配，还是换个穿法？</p>
      <div className="rotation-options">
        {options.map(({ mode, label, window, hint }) => (
          <label key={mode} className="rotation-option">
            <input
              type="radio"
              name="rotation_mode"
              value={mode}
              checked={value === mode}
              onChange={() => onChange(mode)}
            />
            <span className="rotation-option-copy">
              <span className="rotation-option-heading">
                <strong>{label}</strong>
                <span className="rotation-window">{window}</span>
              </span>
              <small>{hint}</small>
            </span>
          </label>
        ))}
      </div>
      <div id={helpId} className="rotation-choice-help">
        <p aria-live="polite" aria-atomic="true">
          {options.find((option) => option.mode === value)?.detail}
        </p>
        <small>锁定和替换范围优先。选择会保留为草稿，点击「生成搭配」才生效。</small>
      </div>
    </fieldset>
  )
}
