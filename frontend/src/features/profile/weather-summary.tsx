import { useQuery } from '@tanstack/react-query'
import { getWeather, type City } from './api'

export function WeatherSummary({ city }: { city: City | null }) {
  const query = useQuery({
    queryKey: ['weather', city?.id],
    queryFn: () => getWeather(city!.id!),
    enabled: !!city?.id,
    retry: false,
    staleTime: 60000,
    refetchInterval: 60000,
  })
  const reading = query.data?.current
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())
  const valid =
    reading &&
    !reading.stale &&
    Date.parse(reading.expires_at) > Date.now() &&
    reading.valid_for === day
  if (!city?.id) return <span>未设置有效城市 · 可手动填写</span>
  if (query.isPending) return <span>{city.name} · 正在查询</span>
  if (!valid || query.isError || query.data?.errors.length)
    return <span>{city.name} · 请核对天气</span>
  return (
    <span>
      {city.name} ·{' '}
      {reading.temperature_c === null ? '温度未知' : `${Math.round(reading.temperature_c)}℃`} ·{' '}
      {reading.condition}
    </span>
  )
}
