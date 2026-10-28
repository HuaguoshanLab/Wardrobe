import { PageHeader } from '../../components/ui/page-header'
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { useOutfits, OutfitStatus } from '../outfits'
import { citySchema, getLocation } from './api'
import { ConditionsPanel } from './conditions'
import { WeatherSummary } from './weather-summary'
import { WeatherPanel } from './weather'
import './profile.css'

const localDate = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())

export function ConditionsPage() {
  const { sessionId } = useParams()
  const outfits = useOutfits(sessionId, true)
  const location = useQuery({ queryKey: ['location'], queryFn: getLocation })
  const city = location.data?.city ?? null
  const [date, setDate] = useState(localDate)
  useEffect(() => {
    const timer = window.setInterval(() => setDate(localDate()), 30000)
    return () => window.clearInterval(timer)
  }, [])
  const key = `wardrobe.conditions.${date}.${city ? JSON.stringify(city) : 'none'}`
  const snapshot = outfits.session?.revisions.find(
    (revision) => revision.id === outfits.session?.selected_revision_id,
  )?.weather_snapshot
  const snapshotCity = citySchema.nullable().safeParse(snapshot?.city)
  const restoreSubmitted =
    snapshot?.valid_for === date &&
    snapshotCity.success &&
    JSON.stringify(snapshotCity.data) === JSON.stringify(city)
  return (
    <div className="conditions-page subpage">
      <PageHeader
        title="搭配条件"
        backTo={sessionId ? `/outfits/${sessionId}` : '/'}
        backLabel="返回穿搭"
      />
      <p className="muted">{date} · 按今天的安排，准备新的搭配。</p>
      {location.isError && (
        <p className="error" role="alert">
          {location.error.message}
        </p>
      )}
      {location.isPending || outfits.loading ? (
        <p role="status">正在载入默认城市…</p>
      ) : (
        <>
          <div className="today-setup">
            <ConditionsPanel
              key={`${key}.${outfits.session?.id ?? 'none'}`}
              storageKey={`${key}.${outfits.session?.id ?? 'none'}`}
              onGenerate={outfits.generate}
              busy={outfits.busy}
              submitted={restoreSubmitted ? outfits.session?.requirements : undefined}
              weather={
                <WeatherPanel
                  key={key}
                  city={city}
                  draftKey={`${key}.${outfits.session?.id ?? 'none'}`}
                />
              }
              weatherSummary={<WeatherSummary city={city} />}
            />
          </div>
          <OutfitStatus controller={outfits} compact />
          <details className="prepare-session">
            <summary>其他操作</summary>
            <p className="muted">开启独立搭配，清除本次选择和锁定；历史结果仍然保留。</p>
            <div className="actions">
              <button
                className="button button-outline"
                disabled={outfits.busy}
                onClick={outfits.newSession}
              >
                开始新的搭配
              </button>
              {outfits.session && (
                <Link className="text-link" to={`/outfits/${outfits.session.id}`}>
                  返回当前搭配
                </Link>
              )}
            </div>
          </details>
        </>
      )}
    </div>
  )
}
