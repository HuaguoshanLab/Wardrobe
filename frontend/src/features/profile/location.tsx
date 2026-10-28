import { useLocation } from 'react-router'
import { carryCityDraft } from './city-draft'
import { z } from 'zod'
import { Sheet } from '../../components/ui/sheet'
import { EditGuard } from './edit-guard'
import { discardProfileSave, restoreProfileSave, retryProfileSave } from './profile-save'
import { useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '../../components/ui/button'
import {
  citySchema,
  getLocation,
  getProvinces,
  locationSchema,
  saveProfile,
  searchCities,
  type City,
} from './api'

const path = '/profile/location'
const pendingSchema = z.object({ city: citySchema.nullable(), expected_version: z.int() })
const restore = () => restoreProfileSave(path, pendingSchema)

export function LocationPanel() {
  const client = useQueryClient()
  const origin = useLocation()
  const [pending, setPending] = useState(restore)
  const [clear, setClear] = useState(false)
  const [locating, setLocating] = useState(false)
  const query = useQuery({ queryKey: ['location'], queryFn: getLocation })
  const provinces = useQuery({ queryKey: ['provinces'], queryFn: getProvinces })
  const [keyword, setKeyword] = useState('')
  const [results, setResults] = useState<City[]>([])
  const [notice, setNotice] = useState('')
  const [searching, setSearching] = useState(false)
  const searchSequence = useRef(0)
  const manual = useForm<{ province: string; city: string }>({
    defaultValues: {
      province: pending?.payload.city?.adm1 ?? '',
      city: pending?.payload.city?.name ?? '',
    },
  })
  const save = useMutation({
    mutationFn: (city: City | null) => {
      if (!query.data) throw new Error('请先载入默认城市')
      if (pending) return retryProfileSave(path, locationSchema, pending)
      return saveProfile(path, locationSchema, {
        city,
        expected_version: query.data.version,
      })
    },
    onError: () => setPending(restore()),
    onSuccess: (value) => {
      setPending(null)
      setClear(false)
      manual.reset({ province: '', city: '' })
      carryCityDraft(origin.state, value.city)
      client.setQueryData(['location'], value)
      setNotice(value.city ? '默认城市已保存' : '已清空默认城市')
    },
  })
  async function search(q: string) {
    const sequence = ++searchSequence.current
    setSearching(true)
    setNotice('')
    setResults([])
    try {
      const found = await searchCities(q)
      if (sequence !== searchSequence.current) return
      setResults(found)
      if (!found.length) setNotice('没有匹配的大陆城市，请调整名称或手动填写。')
    } catch (error) {
      if (sequence === searchSequence.current)
        setNotice(error instanceof Error ? error.message : '城市搜索失败')
    } finally {
      if (sequence === searchSequence.current) setSearching(false)
    }
  }
  function locate() {
    if (!window.isSecureContext || !navigator.geolocation) {
      setNotice('当前环境无法定位，请搜索或手动填写城市。')
      return
    }
    setLocating(true)
    setNotice('正在请求定位…')
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false)
        void search(
          `${position.coords.longitude.toFixed(2)},${position.coords.latitude.toFixed(2)}`,
        )
      },
      () => {
        setLocating(false)
        setNotice('定位失败或未授权，请搜索或手动填写城市。')
      },
      { timeout: 8000, maximumAge: 300000 },
    )
  }
  return (
    <section className="panel profile-panel">
      <div className="settings-city-current">
        <span className="eyebrow">用于之后的天气查询</span>
        <h2>当前城市</h2>
        <p>
          {query.data?.city
            ? `${query.data.city.adm1} · ${query.data.city.name}（${query.data.city.source === 'manual' ? '手动填写，位置未核验' : '和风城市'}）`
            : query.isPending
              ? '正在读取城市…'
              : query.isError
                ? '城市读取失败'
                : '尚未选择城市'}
        </p>
        {query.data?.city && (
          <button
            className="text-link"
            disabled={save.isPending || !!pending}
            onClick={() => setClear(true)}
          >
            清空默认城市
          </button>
        )}
        {query.isError && (
          <Button variant="outline" onClick={() => void query.refetch()}>
            重新读取
          </Button>
        )}
      </div>
      <h2 className="settings-section-title">更换城市</h2>
      <p className="muted">搜索城市或区县，点击结果即可设为默认城市。</p>
      <fieldset className="plain-fieldset" disabled={save.isPending || !!pending}>
        <form
          className="actions"
          onSubmit={(event) => {
            event.preventDefault()
            void search(keyword)
          }}
        >
          <input
            aria-label="搜索城市"
            placeholder="输入城市或区县名称"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            maxLength={80}
          />
          <Button disabled={!keyword.trim() || searching} type="submit">
            {searching ? '搜索中…' : '搜索城市'}
          </Button>
          <Button variant="outline" type="button" disabled={locating || searching} onClick={locate}>
            {locating ? '定位中…' : '使用当前位置'}
          </Button>
        </form>
        <div className="city-results">
          {results.map((city) => (
            <Button
              variant="outline"
              key={city.id}
              disabled={save.isPending || !query.data}
              onClick={() => save.mutate(city)}
            >
              {city.adm1} / {city.adm2} / {city.name}
            </Button>
          ))}
        </div>
        <p className="muted">
          仅中国大陆。定位只在点击后请求，选择结果后才保存。服务未配置时仍可手动填写。
        </p>
        <details
          className="settings-disclosure"
          open={pending?.payload.city?.source === 'manual' ? true : undefined}
        >
          <summary>找不到城市？手动填写</summary>
          <p className="muted">手填城市仅保存名称，不能自动获取天气；搭配时可手动填写天气。</p>
          <form
            className="attribute-form"
            onSubmit={manual.handleSubmit((data) =>
              save.mutate({
                id: null,
                name: data.city.trim(),
                adm1: data.province,
                adm2: '',
                latitude: null,
                longitude: null,
                source: 'manual',
              }),
            )}
          >
            <div className="attribute-grid">
              <label>
                省级地区
                <select required {...manual.register('province', { required: true })}>
                  <option value="">请选择</option>
                  {provinces.data?.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </label>
              <label>
                手填城市
                <input
                  required
                  maxLength={80}
                  {...manual.register('city', { required: true, validate: (v) => !!v.trim() })}
                />
              </label>
            </div>
            <div className="actions">
              <Button type="submit" disabled={save.isPending || !query.data}>
                保存手填城市
              </Button>
            </div>
          </form>
        </details>
      </fieldset>
      {notice && <p role="status">{notice}</p>}
      {(save.error || query.error || provinces.error) && (
        <p role="alert" className="error">
          {(save.error ?? query.error ?? provinces.error)?.message}
        </p>
      )}
      {pending && (
        <div className="notice">
          <p>上次城市保存结果尚未确认。请重试保存，或放弃修改后读取最新城市。</p>
          <Button disabled={save.isPending} onClick={() => save.mutate(pending.payload.city)}>
            重试保存
          </Button>
        </div>
      )}
      <EditGuard
        dirty={manual.formState.isDirty || !!pending}
        busy={save.isPending}
        onDiscard={async () => {
          const latest = await query.refetch()
          if (!latest.isSuccess) throw latest.error ?? new Error('读取失败')
          discardProfileSave(path)
          setPending(null)
          manual.reset({ province: '', city: '' })
          save.reset()
          setNotice('已读取最新城市')
        }}
      />
      <Sheet
        title="清空默认城市？"
        trigger={<span hidden />}
        open={clear}
        onOpenChange={(open) => {
          if (!save.isPending) setClear(open)
        }}
      >
        <p>清空后将不再根据这个城市查询天气。你仍可在搭配条件中手动填写天气，已有搭配不受影响。</p>
        {save.error && (
          <p role="alert" className="error">
            {save.error.message}
          </p>
        )}
        <div className="actions">
          <Button variant="outline" disabled={save.isPending} onClick={() => setClear(false)}>
            保留城市
          </Button>
          <Button disabled={save.isPending || !!pending} onClick={() => save.mutate(null)}>
            {save.isPending ? '正在清空…' : '确认清空'}
          </Button>
        </div>
      </Sheet>
    </section>
  )
}
