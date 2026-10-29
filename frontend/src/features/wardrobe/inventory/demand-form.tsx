import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { Button } from '../../../components/ui/button'
import { SheetFooter } from '../../../components/ui/sheet'
import { Choices } from '../choices'
import type { Subtype } from '../lifecycle-api'
import { demandSchema, estimateTarget, rotationSchema, type Demand, type Rotation } from './api'

export function DemandForm({
  initial,
  fields,
  subtypes,
  tags,
  busy,
  onDirty,
  onApply,
}: {
  initial: Demand
  fields: Record<string, Record<string, string>>
  subtypes: Subtype[]
  tags: { id: string; name: string }[]
  busy: boolean
  onDirty: () => void
  onApply: (row: Demand) => void
}) {
  const {
    register,
    watch,
    setValue,
    handleSubmit,
    formState: { errors },
  } = useForm<Demand>({
    defaultValues: initial,
    resolver: zodResolver(demandSchema),
    mode: 'onBlur',
  })
  const values = watch()
  const update = <K extends keyof Demand>(key: K, value: Demand[K]) => {
    setValue<keyof Demand>(key, value, { shouldDirty: true, shouldValidate: true })
    onDirty()
  }
  const toggle = (key: 'subtype_ids' | 'occasion_codes' | 'tag_ids', value: string) => {
    const next = values[key].includes(value)
      ? values[key].filter((v) => v !== value)
      : [...values[key], value]
    update(key, next)
    if (key === 'occasion_codes' && next.includes('formal')) update('estimate', null)
  }
  const number = (value: string | null) => (value === '' || value === null ? null : Number(value))
  return (
    <form
      id="demand-form"
      className="inventory-form"
      // Zod validates the saved demand; unused calculator inputs are independent.
      noValidate
      onChange={onDirty}
      onSubmit={handleSubmit(onApply)}
    >
      <fieldset disabled={busy}>
        <p className="muted">填写名称、大类与数量即可。更具体的归类规则可以稍后补充。</p>
        <label>
          需求名称
          <input {...register('name')} maxLength={80} placeholder="例如：通勤衬衫" />
        </label>
        {errors.name && (
          <p role="alert" className="error">
            {errors.name.message}
          </p>
        )}
        <label>
          大类
          <select
            value={values.category}
            onChange={(e) => {
              update('category', e.target.value)
              update('subtype_ids', [])
              update('estimate', null)
            }}
          >
            {Object.entries(fields.category ?? { top: '上装' }).map(([id, name]) => (
              <option value={id} key={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <section className="inventory-target-fields">
          <div className="inventory-target-heading">
            <h3>想保有多少件</h3>
            <Button
              variant="outline"
              onClick={() => {
                update('lower', null)
                update('upper', null)
                update('estimate', null)
              }}
            >
              暂不设目标
            </Button>
          </div>
          <div className="inventory-number-pair">
            <label>
              目标下限
              <input
                type="number"
                min={0}
                max={10000}
                step={1}
                inputMode="numeric"
                {...register('lower', { setValueAs: number })}
              />
            </label>
            <label>
              目标上限
              <input
                type="number"
                min={0}
                max={10000}
                step={1}
                inputMode="numeric"
                {...register('upper', { setValueAs: number })}
              />
            </label>
          </div>
          <p className="muted">两项留空＝暂未设定；0–0＝不计划保有。不直接修改库存。</p>
          {(errors.lower || errors.upper) && (
            <p role="alert" className="error">
              {errors.upper?.message ?? errors.lower?.message}
            </p>
          )}
        </section>
        {['top', 'bottom', 'dress'].includes(values.category) &&
        !values.occasion_codes.includes('formal') ? (
          <details className="inventory-disclosure inventory-estimate-disclosure">
            <summary>不确定件数？估算日常轮换</summary>
            <RotationEstimator
              key={`${values.category}-${values.occasion_codes.join(',')}`}
              row={values}
              onAdopt={(lower, inputs) => {
                update('lower', lower)
                update('estimate', inputs)
              }}
            />
          </details>
        ) : (
          <p className="muted">外套、正式用途及配饰等请手动设定目标，不使用洗衣周期推算。</p>
        )}
        {values.estimate && (
          <p className="inventory-estimate-note">
            此草稿曾采用轮换估算：每周 {values.estimate.weekly_days} 天，每{' '}
            {values.estimate.laundry_days} 天洗，晾干 {values.estimate.drying_days} 天，每件穿{' '}
            {values.estimate.repeat_wears} 次，备用 {values.estimate.spare} 件。目标仍可自行修改。
          </p>
        )}
        <details
          className="inventory-disclosure"
          open={
            initial.subtype_ids.length + initial.occasion_codes.length + initial.tag_ids.length > 0
          }
        >
          <summary>
            细化匹配规则
            {values.subtype_ids.length + values.occasion_codes.length + values.tag_ids.length > 0
              ? ` · 已选 ${values.subtype_ids.length + values.occasion_codes.length + values.tag_ids.length} 项`
              : ' · 选填'}
          </summary>
          <p className="muted">名称不决定归类。子类、场合、标签决定哪些衣服可以计入。</p>
          <Choices
            label="子类 · 可多选，不选则不限"
            options={Object.fromEntries(
              subtypes
                .filter(
                  (s) =>
                    s.category === values.category &&
                    (s.active || values.subtype_ids.includes(s.id)),
                )
                .map((s) => [s.id, `${s.name}${s.active ? '' : '（已停用）'}`]),
            )}
            selected={values.subtype_ids}
            onChange={(value) => toggle('subtype_ids', value)}
          />
          {!subtypes.some((s) => s.category === values.category) && (
            <p className="muted">此大类暂无子类，可先保存需求，再到“管理子类”添加。</p>
          )}

          <Choices
            label="场合 · 可多选"
            options={fields.occasion_codes ?? {}}
            selected={values.occasion_codes}
            onChange={(value) => toggle('occasion_codes', value)}
          />
          <Choices
            label="标签 · 可多选"
            options={{
              ...Object.fromEntries(values.tag_ids.map((id) => [id, '已删除标签 · 点击移除'])),
              ...Object.fromEntries(tags.map((t) => [t.id, t.name])),
            }}
            selected={values.tag_ids}
            onChange={(value) => toggle('tag_ids', value)}
          />
          <p className="muted">不同字段都要满足；同一字段选择多个值，满足其中一个即可。</p>
        </details>
        <details className="inventory-disclosure" open={!!initial.notes || !initial.enabled}>
          <summary>备注与启用状态{!values.enabled && ' · 已停用'}</summary>
          <label>
            需求备注
            <textarea
              {...register('notes')}
              maxLength={1000}
              placeholder="例如：收纳空间有限，先修好现有衣服"
            />
          </label>
          <label className="inventory-checkbox">
            <input type="checkbox" {...register('enabled')} />
            启用这条需求
          </label>
          <p className="muted">停用保留配置和衣服，暂不参与目标结论与共享覆盖。</p>
        </details>
      </fieldset>
      <SheetFooter>
        <Button type="submit" form="demand-form" disabled={busy}>
          应用到本季草稿
        </Button>
      </SheetFooter>
    </form>
  )
}

function RotationEstimator({
  row,
  onAdopt,
}: {
  row: Demand
  onAdopt: (lower: number, values: Rotation) => void
}) {
  const [values, setValues] = useState<Rotation>(
    row.estimate ?? { weekly_days: 7, laundry_days: 3, drying_days: 1, repeat_wears: 1, spare: 1 },
  )
  const [error, setError] = useState('')
  const mutation = useMutation({
    mutationFn: (inputs: Rotation) => estimateTarget(row.category, row.occasion_codes, inputs),
  })
  const fields = [
    ['weekly_days', '每周使用天数', 0, 7],
    ['laundry_days', '洗衣间隔（天）', 1, 60],
    ['drying_days', '晾干天数', 0, 30],
    ['repeat_wears', '每件允许重复穿次数', 1, 100],
    ['spare', '备用件数', 0, 100],
  ] as const
  return (
    <div className="inventory-estimator">
      <p className="muted">以下是示例参数，请按你的习惯调整。只估算轮换容量，不代表卫生标准。</p>
      {fields.map(([key, title, min, max]) => (
        <label key={key}>
          {title}
          <input
            type="number"
            min={min}
            max={max}
            step={1}
            inputMode="numeric"
            value={Number.isNaN(values[key]) ? '' : values[key]}
            onChange={(e) => {
              setValues({ ...values, [key]: e.target.value === '' ? NaN : Number(e.target.value) })
              mutation.reset()
              setError('')
            }}
          />
        </label>
      ))}
      <Button
        variant="outline"
        disabled={mutation.isPending}
        onClick={() => {
          if (!rotationSchema.safeParse(values).success) {
            setError('请填写有效的整数参数；重复穿次数至少为 1。')
            return
          }
          setError('')
          mutation.mutate({ ...values })
        }}
      >
        {mutation.isPending ? '正在计算…' : '计算参考下限'}
      </Button>
      {(error || mutation.error) && (
        <p className="error" role="alert">
          {error || mutation.error?.message}
        </p>
      )}
      {mutation.data && JSON.stringify(mutation.variables) === JSON.stringify(values) && (
        <div className="inventory-estimate-result">
          <strong>参考下限 {mutation.data.lower} 件</strong>
          <p>{mutation.data.explanation}</p>
          <Button
            variant="outline"
            onClick={() => onAdopt(mutation.data!.lower, mutation.variables!)}
          >
            采用此下限到草稿
          </Button>
          <p className="muted">请自行填写上限；保存本季目标后才生效。</p>
        </div>
      )}
    </div>
  )
}
