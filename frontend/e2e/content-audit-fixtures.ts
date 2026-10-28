import type { Page } from '@playwright/test'
import type { Revision } from '../src/features/outfits/api'
export const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
export const longName = '长名称测试'.repeat(20)
export const longNotes = '长备注检查，保留完整内容。'.repeat(70)
const slots = ['top', 'bottom', 'shoes', 'outerwear', 'bag', 'hat', 'scarf', 'belt', 'jewelry']
export function revision(count = 3): Revision {
  return {
    id: id(1),
    session_id: id(2),
    run_id: id(3),
    parent_revision_id: null,
    created_at: '2026-10-28T01:00:00Z',
    provider_mode: 'fake',
    reason: '保存时的说明。'.repeat(150),
    unmet_requirements: [],
    weather_snapshot: {},
    request_snapshot: {},
    items: slots.slice(0, count).map((slot, i) => ({
      item_id: id(10 + i),
      garment_id: id(20 + i),
      display_asset_id: id(30 + i),
      slot,
      source: 'wardrobe',
      image_url: '/audit-assets/item.svg',
      attributes: { name: i === 0 ? longName : `测试${slot}`, category: slot, notes: longNotes },
      description: null,
    })),
  }
}
export async function mockAudit(page: Page, rev: Revision, empty = false) {
  const writes: string[] = []
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const envelope = (data: unknown) => ({ data, request_id: id(99) })
  await page.route('**/audit-assets/**', (route) =>
    route.request().url().endsWith('missing.png')
      ? route.fulfill({ status: 404, body: 'missing' })
      : route.fulfill({
          contentType: 'image/svg+xml',
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="180"><rect x="10" y="5" width="100" height="170" rx="12" fill="#a4b5a0"/><text x="25" y="95" font-size="16">UI test</text></svg>',
        }),
  )
  await page.route('**/api/v1/**', (route) => {
    const req = route.request()
    if (req.method() !== 'GET') {
      writes.push(req.url())
      return route.abort('blockedbyclient')
    }
    const path = new URL(req.url()).pathname
    let data: unknown
    if (path.endsWith('/outfit-sessions/current'))
      data = empty
        ? null
        : {
            id: id(2),
            version: 1,
            selected_revision_id: rev.id,
            requirements: {
              occasion_codes: [],
              season_codes: [],
              style_codes: null,
              custom_tag_ids: [],
              notes: null,
              weather_override: null,
            },
            locked_garment_ids: rev.items.length ? [id(20)] : [],
            invalid_garment_ids: rev.items.length ? [id(21)] : [],
            removed_lock_ids: [],
            current_job_id: null,
            latest_revision_ids: [rev.id],
            revisions: [rev],
            messages: [],
          }
    else if (path.endsWith('/outfit-revisions'))
      data = {
        items: empty ? [] : [{ revision: rev, version: 1, hidden_from_history_at: null }],
        next_cursor: null,
      }
    else if (path.includes('/outfit-revisions/')) data = rev
    else if (path.endsWith('/favorites'))
      data = {
        items: empty
          ? []
          : [
              {
                id: id(40),
                revision_id: rev.id,
                name: longName,
                version: 1,
                created_at: rev.created_at,
                revision: rev,
              },
            ],
        next_cursor: null,
      }
    else if (path.endsWith('/wear-records'))
      data = {
        items: empty
          ? []
          : [
              {
                id: id(41),
                revision_id: rev.id,
                worn_on: '2026-10-28',
                timezone: 'Asia/Shanghai',
                notes: longNotes,
                version: 1,
                created_at: rev.created_at,
                revision: rev,
              },
            ],
        next_cursor: null,
      }
    else return route.continue()
    return route.fulfill({ json: envelope(data) })
  })
  return { writes, errors }
}
