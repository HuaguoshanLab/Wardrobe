import { z } from 'zod'
import { api } from '../../../lib/http'
import type { components } from '../../../generated/api'

export const locationListSchema = z.object({
  items: z.array(z.object({ location: z.string(), count: z.int().positive() })),
  next_cursor: z.string().nullable(),
  total_garments: z.int().nonnegative(),
  unassigned_count: z.int().nonnegative(),
  matching_locations: z.int().nonnegative(),
})
const contract: z.ZodType<components['schemas']['LocationList']> = locationListSchema
void contract
export const getLocations = (params: URLSearchParams) =>
  api(`/wardrobe/locations?${params}`, locationListSchema)
export type LocationSelection = { mode: 'all' | 'named' | 'unassigned'; location?: string }
export function locationScope(filters: Record<string, string>) {
  const params = new URLSearchParams()
  for (const key of [
    'q',
    'category',
    'season',
    'occasion',
    'availability',
    'tag_id',
    'ownership',
  ]) {
    if (filters[key]) params.set(key, filters[key])
  }
  return params
}
