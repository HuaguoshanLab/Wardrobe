import { z } from 'zod'
import { citySchema, type City } from './api'
import { draftSchema } from './conditions'

// Only migrate the draft explicitly carried by the conditions → city navigation.
export function carryCityDraft(state: unknown, city: City | null) {
  const origin = z
    .object({ conditionsDraftKey: z.string(), conditionsDraftCity: citySchema.nullable() })
    .safeParse(state)
  if (!origin.success) return
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())
  const previous = origin.data.conditionsDraftCity
  const prefix = `wardrobe.conditions.${day}.${previous ? JSON.stringify(previous) : 'none'}.`
  const source = origin.data.conditionsDraftKey
  if (!source.startsWith(prefix) || JSON.stringify(previous) === JSON.stringify(city)) return
  const session = source.slice(prefix.length)
  if (session !== 'none' && !z.uuid().safeParse(session).success) return
  try {
    const draft = draftSchema.parse(JSON.parse(localStorage.getItem(source) ?? 'null'))
    const target = `wardrobe.conditions.${day}.${city ? JSON.stringify(city) : 'none'}.${session}`
    localStorage.setItem(
      target,
      JSON.stringify({
        ...draft,
        requirements: { ...draft.requirements, weather_override: null },
        manual: false,
        temperature: '',
        condition: '',
      }),
    )
  } catch {
    /* Invalid or unavailable local drafts cannot prevent a successful city save. */
  }
}
