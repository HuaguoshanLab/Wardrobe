import './conditions.css'
import { Sparkles } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { useMutation, useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { Button } from '../../components/ui/button'
import { api } from '../../lib/http'
import { getTaxonomy } from '../wardrobe'
import { Choices } from './choices'
import { previewConditions, requirementsSchema, type Requirements } from './api'

const empty: Requirements = {
  occasion_codes: [],
  style_codes: null,
  season_codes: [],
  custom_tag_ids: [],
  notes: null,
  weather_override: null,
}
export const draftSchema = z.object({
  requirements: requirementsSchema,
  manual: z.boolean(),
  temperature: z.string(),
  condition: z.string(),
})
function loadDraft(key: string, submitted?: Requirements) {
  try {
    return draftSchema.parse(JSON.parse(localStorage.getItem(key) ?? 'null'))
  } catch {
    return {
      requirements: submitted ?? empty,
      manual: !!submitted?.weather_override,
      temperature: submitted?.weather_override
        ? String(submitted.weather_override.temperature_c)
        : '',
      condition: submitted?.weather_override?.condition ?? '',
    }
  }
}

export function ConditionsPanel({
  storageKey,
  onGenerate,
  busy = false,
  submitted,
  weather,
  weatherSummary,
}: {
  storageKey: string
  onGenerate?: (requirements: Requirements) => void
  busy?: boolean
  submitted?: Requirements
  weatherSummary?: ReactNode
  weather?: ReactNode
}) {
  const weatherRef = useRef<HTMLDetailsElement>(null)
  const temperatureRef = useRef<HTMLInputElement>(null)
  const [initial] = useState(() => loadDraft(storageKey, submitted))
  const form = useForm<Requirements>({ defaultValues: initial.requirements })
  const [manual, setManual] = useState(initial.manual)
  const [temperature, setTemperature] = useState(initial.temperature)
  const [condition, setCondition] = useState(initial.condition)
  const [validation, setValidation] = useState('')
  const taxonomy = useQuery({ queryKey: ['taxonomy'], queryFn: getTaxonomy })
  const tags = useQuery({
    queryKey: ['tags'],
    queryFn: () =>
      api('/tags', z.array(z.object({ id: z.uuid(), name: z.string(), version: z.int() }))),
  })
  const values = form.watch()
  useEffect(() => {
    localStorage.setItem(
      storageKey,
      JSON.stringify({ requirements: values, manual, temperature, condition }),
    )
  }, [storageKey, values, manual, temperature, condition])
  const preview = useMutation({
    mutationFn: previewConditions,
    onError: () => {
      void tags.refetch()
    },
  })
  const missingTags = tags.isSuccess
    ? values.custom_tag_ids.filter((id) => !tags.data.some((tag) => tag.id === id))
    : []
  function save(data: Requirements, generate = false) {
    const candidate = {
      ...data,
      weather_override: manual
        ? { temperature_c: temperature.trim() ? Number(temperature) : NaN, condition }
        : null,
    }
    const parsed = requirementsSchema.safeParse(candidate)
    if (!parsed.success) {
      setValidation('请输入 -90 至 60℃ 的温度和天气现象；0℃有效。')
      if (weatherRef.current) weatherRef.current.open = true
      temperatureRef.current?.focus()
      return
    }
    setValidation('')
    localStorage.setItem(
      storageKey,
      JSON.stringify({ requirements: parsed.data, manual, temperature, condition }),
    )
    if (generate && onGenerate) onGenerate(parsed.data)
    else preview.mutate(parsed.data)
  }
  return (
    <section className="panel profile-panel conditions-panel">
      <h2>今天想怎么穿？</h2>
      <p>选个场合，或直接按你的偏好生成。</p>
      <form
        noValidate
        className="attribute-form"
        onChange={() => preview.reset()}
        onSubmit={form.handleSubmit((data) => save(data))}
      >
        <fieldset className="plain-fieldset" disabled={preview.isPending || busy}>
          <details
            ref={weatherRef}
            className="condition-weather"
            open={initial.manual || undefined}
          >
            <summary>
              天气与城市{' '}
              {manual ? (
                <span>
                  手动 · {temperature || '—'}℃ · {condition || '待填写'}
                </span>
              ) : (
                (weatherSummary ?? <span>自动获取 · 可修改</span>)
              )}
            </summary>
            {weather}
            <label>
              天气来源
              <select
                value={manual ? 'manual' : 'qweather'}
                onChange={(e) => setManual(e.target.value === 'manual')}
              >
                <option value="qweather">使用有效的和风天气</option>
                <option value="manual">手动填写 / 覆盖</option>
              </select>
            </label>
            {manual && (
              <div className="attribute-grid">
                <label>
                  手动温度（℃）
                  <input
                    ref={temperatureRef}
                    type="number"
                    step="any"
                    min="-90"
                    max="60"
                    required
                    value={temperature}
                    onChange={(e) => setTemperature(e.target.value)}
                  />
                </label>
                <label>
                  天气现象
                  <input
                    required
                    maxLength={80}
                    value={condition}
                    onChange={(e) => setCondition(e.target.value)}
                    placeholder="例如：阴天、小雨"
                  />
                </label>
              </div>
            )}
          </details>
          <Choices
            label="场合"
            options={taxonomy.data?.fields.occasion_codes ?? {}}
            value={values.occasion_codes}
            onChange={(v) => form.setValue('occasion_codes', v)}
          />
          <label>
            本次补充要求
            <textarea
              maxLength={1000}
              {...form.register('notes')}
              placeholder="例如：今天要走很多路，想穿得轻便些"
            />
          </label>
          <details
            className="condition-options"
            open={initial.requirements.custom_tag_ids.length > 0 || undefined}
          >
            <summary>更多条件 · 风格、季节与标签</summary>
            <label>
              风格来源
              <select
                value={values.style_codes === null ? 'preferences' : 'override'}
                onChange={(e) =>
                  form.setValue('style_codes', e.target.value === 'preferences' ? null : [])
                }
              >
                <option value="preferences">使用最新长期偏好</option>
                <option value="override">本次单独指定</option>
              </select>
            </label>
            {values.style_codes !== null && (
              <Choices
                label="本次风格（不选表示本次不限制）"
                options={taxonomy.data?.fields.style_codes ?? {}}
                value={values.style_codes}
                onChange={(v) => form.setValue('style_codes', v)}
              />
            )}
            <Choices
              label="季节"
              options={taxonomy.data?.fields.seasons ?? {}}
              value={values.season_codes}
              onChange={(v) => form.setValue('season_codes', v)}
            />
            <Choices
              label="自定义标签"
              options={Object.fromEntries(tags.data?.map((tag) => [tag.id, tag.name]) ?? [])}
              value={values.custom_tag_ids}
              onChange={(v) => form.setValue('custom_tag_ids', v)}
            />
            {missingTags.length > 0 && (
              <div className="notice">
                <p>草稿中有 {missingTags.length} 个标签已删除，请移除后保存。其他条件会保留。</p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    form.setValue(
                      'custom_tag_ids',
                      values.custom_tag_ids.filter((id) => !missingTags.includes(id)),
                    )
                    preview.reset()
                  }}
                >
                  移除已删除标签
                </Button>
              </div>
            )}
          </details>
          <div className="condition-actions">
            {onGenerate && (
              <Button type="button" onClick={form.handleSubmit((data) => save(data, true))}>
                <Sparkles size={18} aria-hidden="true" />
                {busy ? '正在处理搭配…' : '生成搭配'}
              </Button>
            )}
            <Button type="submit" variant="outline" className="condition-check">
              {preview.isPending ? '正在核对…' : '核对条件'}
            </Button>
          </div>
          <p className="form-hint">最多 3 套，点击才生成。草稿自动保存在本浏览器。</p>
        </fieldset>
      </form>
      {(validation || preview.error || taxonomy.error || tags.error) && (
        <p role="alert" className="error">
          {validation || (preview.error ?? taxonomy.error ?? tags.error)?.message}
        </p>
      )}
      {preview.data && (
        <div role="status" className="notice">
          <strong>条件已核对，未生成搭配</strong>
          <p>
            生效风格：
            {preview.data.effective_preferences.style_codes
              .map((v) => taxonomy.data?.fields.style_codes?.[v] ?? v)
              .join('、') || '不指定'}{' '}
          </p>
          {preview.data.requirements.weather_override && (
            <p>
              手动天气：{preview.data.requirements.weather_override.temperature_c}℃ ·{' '}
              {preview.data.requirements.weather_override.condition}
            </p>
          )}
          <p>当前核对的是条件草稿；点击生成后提交到会话，并重新检查天气时效和最新偏好。</p>
        </div>
      )}
    </section>
  )
}
