import { MapPin, RefreshCw } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { Button } from '../../components/ui/button'
import { getWeather, type City } from './api'

const temperature = (value: number | null) =>
  value === null
    ? '未知'
    : new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(value)

export function WeatherPanel({ city }: { city: City | null }) {
  const query = useQuery({
    queryKey: ['weather', city?.id],
    queryFn: () => getWeather(city!.id!),
    enabled: !!city?.id,
    retry: false,
    staleTime: 60000,
    refetchInterval: 60000,
  })
  return (
    <section className="panel profile-panel weather-panel">
      <span className="eyebrow">TODAY'S WEATHER</span>
      <h2>
        <MapPin size={20} aria-hidden="true" />
        {city?.name ?? '选择你的城市'}
      </h2>
      {!city && <p>在设置中保存城市，天气会显示在这里。</p>}
      {!city?.id && (
        <p className="notice">
          {city
            ? '手填城市没有已核验坐标。可在设置中搜索和风城市，或在下方手动填写天气。'
            : '未选择城市也可以手动填写天气。'}
        </p>
      )}
      {query.isFetching && <p role="status">正在查询天气…</p>}
      {query.error && (
        <p className="error" role="alert">
          {query.error.message}
        </p>
      )}
      {!!query.data?.errors.length && (
        <p className="error" role="alert">
          天气服务不可用或数据不完整，请手动填写；过期数据仅供参考。
        </p>
      )}
      <div className="weather-readings">
        {[query.data?.current, query.data?.daily].map(
          (reading) =>
            reading && (
              <article key={reading.kind} className="weather-reading">
                <strong>
                  {reading.kind === 'current' ? '当前实况' : '今日预报'} · {reading.condition}
                </strong>
                <p className="weather-temperature">
                  {reading.kind === 'current'
                    ? `${temperature(reading.temperature_c)}℃`
                    : `${temperature(reading.minimum_c)}–${temperature(reading.maximum_c)}℃`}
                </p>
                {reading.feels_like_c !== null && (
                  <p className="weather-feels">体感 {temperature(reading.feels_like_c)}℃</p>
                )}
                {reading.stale ||
                Date.parse(reading.expires_at) <= Date.now() ||
                reading.valid_for !==
                  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(
                    new Date(),
                  ) ? (
                  <p className="error">已过期，仅供参考</p>
                ) : null}
                <details className="weather-source">
                  <summary>来源与更新时间</summary>
                  <small>
                    和风天气 · 适用日期 {reading.valid_for} · 获取于{' '}
                    {new Date(reading.fetched_at).toLocaleString('zh-CN', {
                      timeZone: 'Asia/Shanghai',
                    })}
                    （北京时间）
                  </small>
                  <p className="muted">
                    {reading.observed_at
                      ? `观测时间 ${reading.observed_at}`
                      : '服务未提供观测时间，获取时间不等于观测时间。'}
                  </p>
                  <a href="https://www.qweather.com/" target="_blank" rel="noreferrer">
                    和风天气
                  </a>
                  {reading.attribution.map((text) => (
                    <p className="weather-attribution" key={text}>
                      {text}
                    </p>
                  ))}
                </details>
              </article>
            ),
        )}
      </div>
      {query.data && <p className="weather-credit">和风天气 · 今日实况与预报</p>}
      <div className="actions weather-actions">
        <Link to="/settings/location" className="text-link">
          更换城市 →
        </Link>
        {city?.id && (
          <Button
            variant="outline"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            <RefreshCw size={15} aria-hidden="true" />
            {query.error || query.data?.errors.length ? '重试天气' : '刷新天气'}
          </Button>
        )}
      </div>
    </section>
  )
}
