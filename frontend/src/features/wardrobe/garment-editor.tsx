import './detail.css'
import { useId, type ReactNode } from 'react'
import { SheetFooter } from '../../components/ui/sheet'
import { useForm } from 'react-hook-form'
import { useQuery } from '@tanstack/react-query'
import { Button } from '../../components/ui/button'
import { Choices } from './choices'
import { getTags, getTaxonomy, type Attributes } from './api'

export function GarmentEditor({
  initial,
  changes,
  onChange,
  busy,
  onSave,
  onCancel,
  children,
}: {
  children?: ReactNode
  initial: Attributes
  changes: Partial<Attributes>
  onChange: (value: Partial<Attributes>) => void
  busy: boolean
  onSave: () => void
  onCancel: () => void
}) {
  const formId = useId()
  const taxonomy = useQuery({ queryKey: ['taxonomies'], queryFn: getTaxonomy })
  const tags = useQuery({ queryKey: ['tags'], queryFn: getTags })
  const {
    register,
    watch,
    setValue,
    handleSubmit,
    formState: { errors },
  } = useForm<Attributes>({ values: { ...initial, ...changes } })
  const values = watch()
  const update = <K extends keyof Attributes>(key: K, value: Attributes[K]) => {
    setValue<keyof Attributes>(key, value, { shouldDirty: true, shouldValidate: true })
    const next = { ...changes, [key]: value }
    if (JSON.stringify(value) === JSON.stringify(initial[key])) delete next[key]
    onChange(next)
  }
  const multiple = (
    key: 'color_codes' | 'seasons' | 'occasion_codes' | 'style_codes' | 'custom_tag_ids',
    label: string,
    options: Record<string, string>,
  ) => (
    <Choices
      label={`${label} · 可多选`}
      options={{
        ...Object.fromEntries(
          values[key].map((code) => [code, options[code] ?? `${code}（待确认）`]),
        ),
        ...options,
      }}
      selected={values[key]}
      onChange={(code) =>
        update(
          key,
          values[key].includes(code)
            ? values[key].filter((value) => value !== code)
            : [...values[key], code],
        )
      }
    />
  )
  const single = (key: 'category' | 'material' | 'thickness' | 'warmth', label: string) => (
    <label>
      {label}
      <select
        aria-label={label}
        {...register(key, { validate: (value) => key !== 'category' || !!value || '请选择品类' })}
        aria-invalid={!!errors[key]}
        value={values[key] ?? ''}
        onChange={(event) => update(key, event.target.value || null)}
      >
        <option value="">{key === 'category' ? '请选择品类' : '未知 / 未填写'}</option>
        {values[key] && !taxonomy.data?.fields[key]?.[values[key]] && (
          <option value={values[key]}>{values[key]}（待确认）</option>
        )}
        {Object.entries(taxonomy.data?.fields[key] ?? {}).map(([code, name]) => (
          <option key={code} value={code}>
            {name}
          </option>
        ))}
      </select>
      {errors[key] && (
        <small className="error" role="alert">
          {errors[key]?.message}
        </small>
      )}
    </label>
  )
  return (
    <form
      className="garment-editor"
      id={formId}
      noValidate
      onSubmit={handleSubmit(() => {
        if (Object.keys(changes).length && !busy) onSave()
      })}
    >
      <p className="muted">品类必填；其他属性留空表示未知。</p>
      {(taxonomy.error || tags.error) && (
        <p role="alert" className="error">
          部分选项读取失败。
          <Button
            variant="outline"
            onClick={() => {
              void taxonomy.refetch()
              void tags.refetch()
            }}
          >
            重试选项
          </Button>
        </p>
      )}
      <fieldset disabled={busy} className="editor-fields">
        <section>
          <h2>基本信息</h2>
          <label>
            名称
            <input
              {...register('name')}
              value={values.name ?? ''}
              maxLength={100}
              placeholder="给这件衣服起个名字"
              onChange={(event) => update('name', event.target.value || null)}
            />
          </label>
          {single('category', '品类')}
        </section>
        {children}
        <section>
          <h2>外观与适用场景</h2>
          {multiple('color_codes', '颜色', taxonomy.data?.fields.color_codes ?? {})}
          {multiple('seasons', '季节', taxonomy.data?.fields.seasons ?? {})}
          {multiple('occasion_codes', '场合', taxonomy.data?.fields.occasion_codes ?? {})}
          {multiple('style_codes', '风格', taxonomy.data?.fields.style_codes ?? {})}
        </section>
        <section>
          <h2>材质与保暖</h2>
          <div className="editor-select-grid">
            {single('material', '材质')}
            {single('thickness', '厚度')}
            {single('warmth', '保暖程度')}
          </div>
        </section>
        <section>
          <h2>我的标签</h2>
          {multiple(
            'custom_tag_ids',
            '自定义标签',
            Object.fromEntries((tags.data ?? []).map((tag) => [tag.id, tag.name])),
          )}
          {tags.data?.length === 0 && <p className="muted">还没有标签，可在衣橱顶部管理标签。</p>}
        </section>
      </fieldset>
      <SheetFooter>
        <div className="editor-save-bar">
          <Button variant="outline" disabled={busy} onClick={onCancel}>
            取消编辑
          </Button>
          <Button type="submit" form={formId} disabled={busy || !Object.keys(changes).length}>
            {busy ? '正在保存…' : '保存修改'}
          </Button>
        </div>
      </SheetFooter>
    </form>
  )
}
