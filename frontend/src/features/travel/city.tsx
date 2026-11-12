import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '../../components/ui/button'
import { getProvinces, searchCities, type City } from '../profile'

export function TravelCity({ value, onChange }: { value: City; onChange: (city: City) => void }) {
  const provinces = useQuery({ queryKey: ['provinces'], queryFn: getProvinces })
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const cities = useQuery({
    queryKey: ['travel-city', query],
    queryFn: () => searchCities(query),
    enabled: !!query,
    retry: false,
  })
  return (
    <fieldset className="travel-fields">
      <legend>目的地 · 中国大陆</legend>
      <p>
        当前：{value.adm1} · {value.name || '尚未填写'}
        {value.source === 'qweather' ? ' · 自动预报' : ' · 手填城市'}
      </p>
      <label>
        搜索预报城市
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="例如：深圳"
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
            event.preventDefault()
            if (!search.trim() || cities.isFetching) return
            if (query === search.trim()) void cities.refetch()
            else setQuery(search.trim())
          }}
        />
      </label>
      <Button
        type="button"
        variant="outline"
        disabled={!search.trim() || cities.isFetching}
        onClick={() => {
          if (query === search.trim()) void cities.refetch()
          else setQuery(search.trim())
        }}
      >
        {cities.isFetching ? '搜索中…' : '搜索城市'}
      </Button>
      {cities.error && <p role="alert">搜索暂不可用，请手填目的地。</p>}
      {cities.data && !cities.data.length && <p>未找到城市，请手填。</p>}
      {cities.data?.map((city) => (
        <Button
          key={city.id}
          type="button"
          variant="outline"
          onClick={() => {
            onChange(city)
            setQuery('')
          }}
        >
          {city.adm1} · {city.adm2} · {city.name}
        </Button>
      ))}
      <details>
        <summary>手动填写目的地</summary>
        <div className="travel-fields">
          <label>
            省份
            <select
              value={value.adm1}
              onChange={(e) =>
                onChange({
                  source: 'manual',
                  id: null,
                  latitude: null,
                  longitude: null,
                  adm1: e.target.value,
                  adm2: '',
                  name: value.name,
                })
              }
            >
              {(provinces.data ?? [value.adm1]).map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <label>
            城市
            <input
              maxLength={80}
              value={value.name}
              onChange={(e) =>
                onChange({
                  source: 'manual',
                  id: null,
                  latitude: null,
                  longitude: null,
                  adm1: value.adm1,
                  adm2: '',
                  name: e.target.value,
                })
              }
            />
          </label>
          {provinces.error && (
            <Button type="button" onClick={() => void provinces.refetch()}>
              重试省份列表
            </Button>
          )}
        </div>
      </details>
    </fieldset>
  )
}
