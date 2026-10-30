import { PageHeader } from '../../components/ui/page-header'
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams, useSearchParams, useLocation } from 'react-router'
import { AnchorNotice, useAnchor } from './anchor'
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
  const [params, setParams] = useSearchParams()
  const navigation = useLocation()
  const requestedAnchor = params.get('anchor')
  const seedAnchor = !outfits.session?.selected_revision_id
    ? (outfits.session?.locked_garment_ids[0] ?? null)
    : null
  const anchor = useAnchor(requestedAnchor ?? seedAnchor)
  const usageReturn =
    typeof navigation.state?.usageReturn === 'string' &&
    /^\/wardrobe\/usage(?:\?|$)/.test(navigation.state.usageReturn)
      ? (navigation.state.usageReturn as string)
      : null
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
        backTo={usageReturn ?? (sessionId ? `/outfits/${sessionId}` : '/')}
        backLabel={usageReturn ? '返回利用情况' : '返回穿搭'}
      />
      <p className="muted">{date} · 按今天的安排，准备新的搭配。</p>
      <AnchorNotice
        anchor={anchor}
        busy={outfits.busy}
        returnTo={usageReturn ?? '/wardrobe/usage'}
        onRemove={() => {
          if (requestedAnchor !== null) {
            const next = new URLSearchParams(params)
            next.delete('anchor')
            setParams(next, { replace: true, state: navigation.state })
          } else void outfits.patch({ locked_garment_ids: [] })
        }}
      />
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
              onGenerate={(requirements) => {
                if (!anchor.blocked) outfits.generate(requirements, requestedAnchor ?? undefined)
              }}
              busy={outfits.busy}
              generateBlocked={anchor.blocked}
              submitted={
                outfits.session
                  ? {
                      ...outfits.session.requirements,
                      weather_override: restoreSubmitted
                        ? outfits.session.requirements.weather_override
                        : null,
                    }
                  : undefined
              }
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
          {requestedAnchor === null && (
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
          )}
        </>
      )}
    </div>
  )
}
