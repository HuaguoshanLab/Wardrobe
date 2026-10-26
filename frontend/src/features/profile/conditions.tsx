import { useState } from 'react'
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
const draftSchema = z.object({
  requirements: requirementsSchema,
  manual: z.boolean(),
  temperature: z.string(),
  condition: z.string(),
})
function loadDraft(key: string) {
  try {
    return draftSchema.parse(JSON.parse(localStorage.getItem(key) ?? 'null'))
  } catch {
    return { requirements: empty, manual: false, temperature: '', condition: '' }
  }
}

export function ConditionsPanel({ storageKey }: { storageKey: string }) {
  const [initial] = useState(() => loadDraft(storageKey))
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
  const preview = useMutation({
    mutationFn: previewConditions,
    onError: () => {
      void tags.refetch()
    },
  })
  const missingTags = tags.isSuccess
    ? values.custom_tag_ids.filter((id) => !tags.data.some((tag) => tag.id === id))
    : []
  function save(data: Requirements) {
    const candidate = {
      ...data,
      weather_override: manual
        ? { temperature_c: temperature.trim() ? Number(temperature) : NaN, condition }
        : null,
    }
    const parsed = requirementsSchema.safeParse(candidate)
    if (!parsed.success) {
      setValidation('请输入 -90 至 60℃ 的温度和天气现象；0℃有效。')
      return
    }
    setValidation('')
    localStorage.setItem(
      storageKey,
      JSON.stringify({ requirements: parsed.data, manual, temperature, condition }),
    )
    preview.mutate(parsed.data)
  }
  return (
    <section className="panel profile-panel">
      <h2>今天的条件</h2>
      <p>条件保存在当前浏览器，刷新可恢复。更换城市或日期后，单独填写本次条件。</p>
      <form
        className="attribute-form"
        onChange={() => preview.reset()}
        onSubmit={form.handleSubmit(save)}
      >
        <fieldset className="plain-fieldset" disabled={preview.isPending}>
          <Choices
            label="场合"
            options={taxonomy.data?.fields.occasion_codes ?? {}}
            value={values.occasion_codes}
            onChange={(v) => form.setValue('occasion_codes', v)}
          />
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
          <label>
            本次补充要求
            <textarea
              maxLength={1000}
              {...form.register('notes')}
              placeholder="例如：今天要走很多路，想穿得轻便些"
            />
          </label>
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
          <Button type="submit">{preview.isPending ? '正在核对…' : '保存并核对条件'}</Button>
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
            · 偏好版本 {preview.data.preference_version}
          </p>
          {preview.data.requirements.weather_override && (
            <p>
              手动天气：{preview.data.requirements.weather_override.temperature_c}℃ ·{' '}
              {preview.data.requirements.weather_override.condition}
            </p>
          )}
          <p>
            当前保存的是条件草稿。生成搭配及跨设备会话恢复将在 P4
            开放；生成时需重新检查天气时效和最新偏好。
          </p>
        </div>
      )}
    </section>
  )
}
