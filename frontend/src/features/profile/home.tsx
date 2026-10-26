import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { getLocation } from './api'
import { ConditionsPanel } from './conditions'
import { WeatherPanel } from './weather'
import './profile.css'

const localDate = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())

export function HomePage() {
  const location = useQuery({ queryKey: ['location'], queryFn: getLocation })
  const city = location.data?.city ?? null
  const [date, setDate] = useState(localDate)
  useEffect(() => {
    const timer = window.setInterval(() => setDate(localDate()), 30000)
    return () => window.clearInterval(timer)
  }, [])
  const key = `wardrobe.conditions.${date}.${city ? JSON.stringify(city) : 'none'}`
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR EVERYDAY EDIT</span>
          <h1>今日穿搭</h1>
          <p>{date} · 先看看天气，再决定今天怎么穿。</p>
        </div>
        <Link to="/wardrobe" className="text-link">
          整理我的衣橱 →
        </Link>
      </div>
      {location.isError && (
        <p className="error" role="alert">
          {location.error.message}
        </p>
      )}
      {location.isPending ? (
        <p role="status">正在载入默认城市…</p>
      ) : (
        <>
          <WeatherPanel key={key} city={city} />
          <ConditionsPanel key={key} storageKey={key} />
        </>
      )}
    </>
  )
}
