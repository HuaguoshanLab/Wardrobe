import { expect, type Page, type APIRequestContext } from '@playwright/test'
const id = 'c4c839f1-12a8-4ea4-9c80-32b080611af7'
const rid = 'd4c839f1-12a8-4ea4-9c80-32b080611af7'
export async function travelFixture(page: Page, request: APIRequestContext) {
  const garments: Array<{
    id: string
    category: string
    image_url: string
    name: string
    image_asset_id: string
  }> = (
    await (await request.get('/api/v1/garments?limit=20&ownership=owned')).json()
  ).data.items.slice(0, 3)
  expect(garments.length).toBeGreaterThan(0)
  const items = garments.map(
    (g: {
      id: string
      category: string
      image_url: string
      name: string
      image_asset_id: string
    }) => ({
      item_id: g.id,
      slot: g.category,
      source: 'wardrobe',
      garment_id: g.id,
      display_asset_id: g.image_asset_id,
      image_url: g.image_url,
      attributes: { name: g.name },
      description: null,
    }),
  )
  const draft = {
    name: '轻装出行 · 三天城市漫步',
    city: {
      name: '深圳',
      adm1: '广东省',
      adm2: '深圳市',
      source: 'manual',
      id: null,
      latitude: null,
      longitude: null,
    },
    days: ['2026-11-11', '2026-11-12', '2026-11-13'].map((date) => ({
      date,
      occasion: 'daily',
      weather: null,
    })),
    required_garment_ids: [],
    target_count: 8,
    allow_repeat: true,
    notes: '',
  }
  const revision = {
    id: rid,
    number: 1,
    days: draft.days.map((d) => ({
      ...d,
      items,
      weather: { source: 'unknown', valid_for: d.date },
      warnings: ['这一天的天气未知，请出发前补充核对。'],
    })),
    request: draft,
    provider_mode: 'fake',
    warnings: ['含重复穿着的基础衣物，请确认清洁条件。'],
    created_at: '2026-11-11T00:00:00Z',
  }
  const plan = {
    id,
    version: 3,
    draft,
    current_job_id: null,
    revision,
    packing: items.map((item) => ({
      garment_id: item.garment_id,
      item,
      dates: draft.days.map((d) => d.date),
      packed: false,
      added: true,
    })),
    created_at: '2026-11-11T00:00:00Z',
  }
  let writes = 0
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.route('**/api/v1/**', async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    if (req.method() !== 'GET') {
      writes++
      return route.abort()
    }
    if (url.pathname === `/api/v1/travel-plans/${id}`)
      return route.fulfill({ json: { data: plan, request_id: id } })
    if (url.pathname === `/api/v1/travel-plans/${id}/revisions`)
      return route.fulfill({
        json: {
          data: [revision, { ...revision, id: 'e4c839f1-12a8-4ea4-9c80-32b080611af7', number: 0 }],
          request_id: id,
        },
      })
    return route.continue()
  })

  return { id, draft, plan, garments, errors, writes: () => writes }
}
