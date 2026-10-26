import { useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '../../components/ui/button'
import {
  getLocation,
  getProvinces,
  locationSchema,
  saveProfile,
  searchCities,
  type City,
} from './api'

export function LocationPanel() {
  const client = useQueryClient()
  const query = useQuery({ queryKey: ['location'], queryFn: getLocation })
  const provinces = useQuery({ queryKey: ['provinces'], queryFn: getProvinces })
  const [keyword, setKeyword] = useState('')
  const [results, setResults] = useState<City[]>([])
  const [notice, setNotice] = useState('')
  const [searching, setSearching] = useState(false)
  const searchSequence = useRef(0)
  const manual = useForm<{ province: string; city: string }>()
  const save = useMutation({
    mutationFn: (city: City | null) => {
      if (!query.data) throw new Error('请先载入默认城市')
      return saveProfile('/profile/location', locationSchema, {
        city,
        expected_version: query.data.version,
      })
    },
    onSuccess: (value) => {
      client.setQueryData(['location'], value)
      setNotice('默认城市已保存')
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
    setNotice('正在请求定位…')
    navigator.geolocation.getCurrentPosition(
      (position) => {
        void search(
          `${position.coords.longitude.toFixed(2)},${position.coords.latitude.toFixed(2)}`,
        )
      },
      () => setNotice('定位失败或未授权，请搜索或手动填写城市。'),
      { timeout: 8000, maximumAge: 300000 },
    )
  }
  return (
    <section className="panel profile-panel">
      <h2>默认城市</h2>
      <p>
        {query.data?.city
          ? `${query.data.city.adm1} · ${query.data.city.name}（${query.data.city.source === 'manual' ? '手动填写，位置未核验' : '和风城市'}）`
          : '尚未选择城市'}
      </p>
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
        <Button variant="outline" type="button" onClick={locate}>
          使用当前位置
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
          <Button
            variant="outline"
            type="button"
            disabled={save.isPending || !query.data?.city}
            onClick={() => save.mutate(null)}
          >
            清空默认城市
          </Button>
        </div>
      </form>
      {notice && <p role="status">{notice}</p>}
      {(save.error || query.error || provinces.error) && (
        <p role="alert" className="error">
          {(save.error ?? query.error ?? provinces.error)?.message}
        </p>
      )}
      {save.isError && (
        <button
          className="text-link"
          onClick={() => {
            void query.refetch()
            save.reset()
          }}
        >
          重新载入城市版本
        </button>
      )}
    </section>
  )
}
