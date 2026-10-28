import { expect, it } from 'vitest'
import { carryCityDraft } from './city-draft'

const city = {
  id: null,
  name: '杭州',
  adm1: '浙江省',
  adm2: '',
  latitude: null,
  longitude: null,
  source: 'manual' as const,
}
const day = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())
const draft = {
  requirements: {
    occasion_codes: ['daily'],
    style_codes: ['casual'],
    season_codes: [],
    custom_tag_ids: [],
    notes: '步行上班',
    weather_override: { temperature_c: 0, condition: '雪' },
  },
  manual: true,
  temperature: '0',
  condition: '雪',
}
it('changing the city carries only the originating conditions and resets old weather', () => {
  const source = `wardrobe.conditions.${day()}.none.none`
  localStorage.setItem(source, JSON.stringify(draft))
  carryCityDraft({ conditionsDraftKey: source, conditionsDraftCity: null }, city)
  const target = `wardrobe.conditions.${day()}.${JSON.stringify(city)}.none`
  expect(JSON.parse(localStorage.getItem(target)!)).toEqual({
    ...draft,
    requirements: { ...draft.requirements, weather_override: null },
    manual: false,
    temperature: '',
    condition: '',
  })
  expect(JSON.parse(localStorage.getItem(source)!)).toEqual(draft)
})
it('direct settings visits and stale or malformed origins never migrate other drafts', () => {
  const source = 'wardrobe.conditions.2000-01-01.none.none'
  localStorage.setItem(source, JSON.stringify(draft))
  const before = { ...localStorage }
  carryCityDraft(null, city)
  carryCityDraft({ conditionsDraftKey: source, conditionsDraftCity: null }, city)
  carryCityDraft({ conditionsDraftKey: 'wardrobe.other', conditionsDraftCity: null }, city)
  expect({ ...localStorage }).toEqual(before)
})
