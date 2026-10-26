import { z } from 'zod'
import type { components } from '../../generated/api'
import { api } from '../../lib/http'
export { saveProfile } from './profile-save'

export const preferencesSchema = z.object({
  style_codes: z.array(z.string()),
  fit: z.enum(['fitted', 'regular', 'loose']).nullable(),
  thermal: z.enum(['cold_sensitive', 'heat_sensitive', 'neutral']).nullable(),
  preferred_colors: z.array(z.string()),
  avoided_colors: z.array(z.string()),
  notes: z.string().nullable(),
}) satisfies z.ZodType<components['schemas']['Preferences']>
export const preferencesView = z.object({ preferences: preferencesSchema, version: z.int() })
export type Preferences = z.infer<typeof preferencesSchema>
export const citySchema = z.object({
  id: z.string().nullable(),
  name: z.string(),
  adm1: z.string(),
  adm2: z.string(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  source: z.enum(['manual', 'qweather']),
}) satisfies z.ZodType<components['schemas']['City']>
export type City = z.infer<typeof citySchema>
export const locationSchema = z.object({ city: citySchema.nullable(), version: z.int() })
export type Location = z.infer<typeof locationSchema>
const readingSchema = z.object({
  source: z.literal('qweather'),
  kind: z.enum(['current', 'daily']),
  city: citySchema,
  observed_at: z.string().nullable(),
  fetched_at: z.string(),
  valid_for: z.string(),
  expires_at: z.string(),
  temperature_c: z.number().nullable(),
  feels_like_c: z.number().nullable(),
  minimum_c: z.number().nullable(),
  maximum_c: z.number().nullable(),
  condition: z.string(),
  precipitation_mm: z.number().nullable(),
  stale: z.boolean(),
  attribution: z.array(z.string()),
}) satisfies z.ZodType<components['schemas']['WeatherReading']>
export const weatherSchema = z.object({
  city: citySchema,
  current: readingSchema.nullable(),
  daily: readingSchema.nullable(),
  errors: z.array(z.string()),
}) satisfies z.ZodType<components['schemas']['WeatherResult']>
export const requirementsSchema = z.object({
  occasion_codes: z.array(z.string()),
  style_codes: z.array(z.string()).nullable(),
  season_codes: z.array(z.string()),
  custom_tag_ids: z.array(z.uuid()),
  notes: z.string().max(1000).nullable(),
  weather_override: z
    .object({
      temperature_c: z.number().min(-90).max(60),
      condition: z.string().trim().min(1).max(80),
    })
    .nullable(),
}) satisfies z.ZodType<components['schemas']['Requirements']>
export type Requirements = z.infer<typeof requirementsSchema>
export const previewSchema = z.object({
  requirements: requirementsSchema,
  effective_preferences: preferencesSchema,
  preference_version: z.int(),
})
export const getPreferences = () => api('/profile/preferences', preferencesView)
export const getLocation = () => api('/profile/location', locationSchema)
export const getProvinces = () => api('/weather/provinces', z.array(z.string()))
export const searchCities = (q: string) =>
  api(`/weather/cities?q=${encodeURIComponent(q)}`, z.array(citySchema))
export const getWeather = (id: string) =>
  api(`/weather?city_id=${encodeURIComponent(id)}`, weatherSchema)
export const previewConditions = (requirements: Requirements) =>
  api('/conditions/preview', previewSchema, { method: 'POST', body: JSON.stringify(requirements) })
