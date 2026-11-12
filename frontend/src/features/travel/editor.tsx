import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useQuery } from '@tanstack/react-query'
import { Sheet, SheetFooter } from '../../components/ui/sheet'
import { Button } from '../../components/ui/button'
import { getTaxonomy } from '../wardrobe'
import { consecutive, draftSchema, inputSchema, today, type TravelInput } from './api'
import { TravelCity } from './city'
import { RequiredPicker } from './picker'

const initial = (): TravelInput => ({
  name: '',
  city: {
    name: '',
    adm1: '广东省',
    adm2: '',
    source: 'manual',
    id: null,
    latitude: null,
    longitude: null,
  },
  days: consecutive(today(), 3).map((date) => ({ date, occasion: 'daily', weather: null })),
  required_garment_ids: [],
  target_count: 10,
  allow_repeat: true,
  notes: '',
})
export function TravelEditor({
  id,
  value,
  busy,
  onSave,
  onClose,
}: {
  id: string
  value?: TravelInput
  busy: boolean
  onSave: (data: TravelInput) => Promise<void>
  onClose: () => void
}) {
  const [resetting, setResetting] = useState(false)
  const resetTrigger = useRef<HTMLButtonElement | null>(null)
  const errorTarget = useRef<HTMLParagraphElement | null>(null)
  const key = `wardrobe.travel.draft:${id}`
  const form = useForm<TravelInput>({
    defaultValues: () => {
      try {
        return Promise.resolve(draftSchema.parse(JSON.parse(localStorage.getItem(key) ?? 'null')))
      } catch {
        return Promise.resolve(value ?? initial())
      }
    },
  })
  const data = form.watch()
  const taxonomy = useQuery({ queryKey: ['taxonomies'], queryFn: getTaxonomy })
  useEffect(() => {
    const subscription = form.watch((value) => {
      if (value.city) localStorage.setItem(key, JSON.stringify(value))
    })
    return () => subscription.unsubscribe()
  }, [form, key])
  if (!data.city || !data.days) return <p>正在恢复草稿…</p>
  const resize = (start: string, length: number) => {
    const dates = consecutive(start, length)
    if (dates.length)
      form.setValue(
        'days',
        dates.map((date, i) => ({
          ...(data.days[i] ?? { occasion: 'daily', weather: null }),
          date,
        })),
        { shouldDirty: true },
      )
  }
  return (
    <form
      className="travel-fields"
      onSubmit={form.handleSubmit(async (values) => {
        const checked = inputSchema.safeParse(values)
        if (!checked.success || !values.city.name.trim()) {
          form.setError('root', {
            message: !values.city.name.trim()
              ? '请选择或手填目的地。'
              : '请核对名称、携带件数和手填天气。',
          })
          requestAnimationFrame(() => errorTarget.current?.focus())
          return
        }
        await onSave(checked.data)
      })}
    >
      <fieldset className="travel-fields travel-form-section">
        <legend>01 · 行程安排</legend>
        <label>
          行程名称
          <input
            {...form.register('name', { required: true, maxLength: 60 })}
            maxLength={60}
            required
            placeholder="例如：三天杭州小旅行"
          />
        </label>
        <TravelCity
          value={data.city}
          onChange={(city) => form.setValue('city', city, { shouldDirty: true })}
        />
        <div className="travel-two">
          <label>
            出发日期
            <input
              type="date"
              required
              value={data.days[0]?.date ?? ''}
              onChange={(e) => resize(e.target.value, data.days.length)}
            />
          </label>
          <label>
            行程天数
            <select
              value={data.days.length}
              onChange={(e) => resize(data.days[0].date, Number(e.target.value))}
            >
              {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                <option key={n} value={n}>
                  {n} 天
                </option>
              ))}
            </select>
          </label>
        </div>
      </fieldset>
      <fieldset className="travel-fields travel-form-section">
        <legend>02 · 每日场合与天气</legend>
        <p>手填天气优先；无对应日期预报时标为未知。</p>
        {data.days.map((day, i) => (
          <div className="travel-day-input" key={i}>
            <h3>
              第 {i + 1} 天 · {day.date}
            </h3>
            <label>
              主要场合
              <select {...form.register(`days.${i}.occasion`)}>
                {Object.entries(taxonomy.data?.fields.occasion_codes ?? { daily: '日常' }).map(
                  ([code, label]) => (
                    <option key={code} value={code}>
                      {label}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label className="travel-check">
              <input
                type="checkbox"
                checked={!!day.weather}
                onChange={(e) =>
                  form.setValue(
                    `days.${i}.weather`,
                    e.target.checked ? { temperature_c: 20, condition: '' } : null,
                    { shouldDirty: true },
                  )
                }
              />
              手动填写这一天的天气
            </label>
            {day.weather && (
              <div className="travel-two">
                <label>
                  温度（℃）
                  <input
                    type="number"
                    min={-90}
                    max={60}
                    step="any"
                    required
                    {...form.register(`days.${i}.weather.temperature_c`, { valueAsNumber: true })}
                  />
                </label>
                <label>
                  天气现象
                  <input
                    required
                    maxLength={80}
                    {...form.register(`days.${i}.weather.condition`)}
                  />
                </label>
              </div>
            )}
          </div>
        ))}
        {taxonomy.error && (
          <Button type="button" onClick={() => void taxonomy.refetch()}>
            重试场合列表
          </Button>
        )}
      </fieldset>
      <fieldset className="travel-fields travel-form-section">
        <legend>03 · 行李与偏好</legend>
        <label>
          期望携带件数
          <input
            type="number"
            min={1}
            max={50}
            required
            {...form.register('target_count', { valueAsNumber: true })}
          />
        </label>
        <p>实际件数可能超出目标。</p>
        <label className="travel-check">
          <input type="checkbox" {...form.register('allow_repeat')} />
          允许上装、下装和裙装重复穿
        </label>
        <p>鞋、包、外套和配饰可跨天复用。</p>
        <RequiredPicker
          ids={data.required_garment_ids}
          onChange={(ids) => form.setValue('required_garment_ids', ids, { shouldDirty: true })}
        />
        <label>
          补充要求
          <textarea rows={3} maxLength={1000} {...form.register('notes')} />
        </label>
      </fieldset>
      {form.formState.errors.root && (
        <p className="error" tabIndex={-1} ref={errorTarget} role="alert">
          {form.formState.errors.root.message}
        </p>
      )}
      <div className="travel-editor-footer">
        <small>草稿仅存此浏览器 · 保存后再生成</small>
        <div className="travel-actions">
          <Button type="submit" disabled={busy}>
            {busy ? '正在保存…' : '保存行程'}
          </Button>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            保留并返回
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            ref={resetTrigger}
            onClick={() => setResetting(true)}
          >
            {value ? '重置草稿' : '清空草稿'}
          </Button>
        </div>
      </div>
      <Sheet
        title={value ? '重置行程草稿？' : '清空行程草稿？'}
        trigger={<span hidden />}
        open={resetting}
        onOpenChange={setResetting}
        finalFocus={resetTrigger}
      >
        <p>{value ? '放弃未保存的修改，恢复已保存条件？' : '清空本次填写内容？'}</p>
        <SheetFooter>
          <Button type="button" variant="outline" onClick={() => setResetting(false)}>
            继续编辑
          </Button>
          <Button
            type="button"
            onClick={() => {
              localStorage.removeItem(key)
              form.reset(value ?? initial())
              setResetting(false)
            }}
          >
            确认重置草稿
          </Button>
        </SheetFooter>
      </Sheet>
    </form>
  )
}
