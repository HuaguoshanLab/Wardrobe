import { Choices } from '../choices'
import { RotationChoice } from '../rotation-choice'
import type { Fields } from './api'
export type Vocabulary = Record<string, Record<string, string>>
export type Tag = { id: string; name: string }
export function TemplateFields({
  value,
  onChange,
  taxonomy,
  tags,
}: {
  value: Fields
  onChange: (f: Fields) => void
  taxonomy: Vocabulary
  tags: Tag[]
}) {
  return (
    <>
      <Choices
        label="模板场合"
        options={taxonomy.occasion_codes ?? {}}
        value={value.occasion_codes}
        onChange={(v) => onChange({ ...value, occasion_codes: v })}
      />
      <label>
        模板风格来源
        <select
          value={value.style_codes === null ? 'inherit' : 'override'}
          onChange={(e) =>
            onChange({ ...value, style_codes: e.target.value === 'inherit' ? null : [] })
          }
        >
          <option value="inherit">生成时使用最新长期偏好</option>
          <option value="override">模板单独指定（不选表示不限）</option>
        </select>
      </label>
      {value.style_codes !== null && (
        <Choices
          label="模板风格"
          options={taxonomy.style_codes ?? {}}
          value={value.style_codes}
          onChange={(v) => onChange({ ...value, style_codes: v })}
        />
      )}
      <Choices
        label="模板标签"
        options={Object.fromEntries(tags.map((t) => [t.id, t.name]))}
        value={value.custom_tag_ids}
        onChange={(v) => onChange({ ...value, custom_tag_ids: v })}
      />
      <RotationChoice
        value={value.rotation_mode}
        onChange={(v) => onChange({ ...value, rotation_mode: v })}
      />
      <label>
        模板补充要求
        <textarea
          maxLength={1000}
          value={value.notes ?? ''}
          onChange={(e) => onChange({ ...value, notes: e.target.value || null })}
        />
      </label>
    </>
  )
}
export function FieldsPreview({
  value,
  taxonomy,
  tags,
}: {
  value: Fields
  taxonomy: Vocabulary
  tags: Tag[]
}) {
  const names = (codes: string[], field: string) =>
    codes.map((v) => taxonomy[field]?.[v] ?? `不支持：${v}`).join('、') || '不限'
  return (
    <dl className="template-preview">
      <dt>场合</dt>
      <dd>{names(value.occasion_codes, 'occasion_codes')}</dd>
      <dt>风格</dt>
      <dd>
        {value.style_codes === null
          ? '使用生成时最新长期偏好'
          : names(value.style_codes, 'style_codes')}
      </dd>
      <dt>标签</dt>
      <dd>
        {value.custom_tag_ids
          .map((id) => tags.find((t) => t.id === id)?.name ?? `已失效：${id}`)
          .join('、') || '不限'}
      </dd>
      <dt>轮换</dt>
      <dd>
        {
          { normal: '正常搭配', avoid_recent: '避开近期组合', less_worn: '优先近期少穿' }[
            value.rotation_mode
          ]
        }
      </dd>
      <dt>补充要求</dt>
      <dd>
        {value.notes && value.notes.length > 100 ? (
          <details className="template-notes">
            <summary>展开完整补充要求（{value.notes.length} 字）</summary>
            <p>{value.notes}</p>
          </details>
        ) : (
          value.notes || '无（替换后清空原补充要求）'
        )}
      </dd>
    </dl>
  )
}
export function invalidFields(value: Fields, taxonomy: Vocabulary, tags: Tag[]) {
  return (
    value.occasion_codes.some((v) => !taxonomy.occasion_codes?.[v]) ||
    value.style_codes?.some((v) => !taxonomy.style_codes?.[v]) ||
    value.custom_tag_ids.some((id) => !tags.some((t) => t.id === id))
  )
}
export function repairFields(value: Fields, taxonomy: Vocabulary, tags: Tag[]): Fields {
  return {
    ...value,
    occasion_codes: value.occasion_codes.filter((v) => taxonomy.occasion_codes?.[v]),
    style_codes: value.style_codes?.filter((v) => taxonomy.style_codes?.[v]) ?? null,
    custom_tag_ids: value.custom_tag_ids.filter((id) => tags.some((t) => t.id === id)),
  }
}
