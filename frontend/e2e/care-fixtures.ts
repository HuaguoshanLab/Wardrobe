import { id } from './content-audit-fixtures'
import { garmentSchema } from '../src/features/wardrobe/api'

export const careGarment = (n: number) =>
  garmentSchema.parse({
    id: id(n),
    image_asset_id: id(99),
    version: 1,
    created_at: '2026-10-30T00:00:00Z',
    image_url: n === 2 ? '/audit-assets/missing.png' : '/audit-assets/item.svg',
    has_cutout: false,
    is_demo: false,
    name: n === 1 ? '浅蓝色棉质衬衫' : `待洗单品 ${n}`,
    category: 'top',
    color_codes: [],
    seasons: [],
    occasion_codes: [],
    style_codes: [],
    material: null,
    thickness: null,
    warmth: null,
    custom_tag_ids: [],
    availability: 'unavailable',
    display_variant: 'original',
    lifecycle: { unavailable_reason: 'washing', location: '衣柜二层' },
  })
