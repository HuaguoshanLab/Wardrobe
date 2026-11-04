import { expect, test } from '@playwright/test'
import { id, mockAudit, revision } from './content-audit-fixtures'
import { careGarment } from './care-fixtures'

async function setup(page: import('@playwright/test').Page) {
  const audit = await mockAudit(page, revision())
  const envelope = (data: unknown) => ({ data, request_id: id(99) })
  await page.route('**/api/v1/garments?*', (r) =>
    r.fulfill({ json: envelope({ items: [careGarment(1)], next_cursor: null }) }),
  )
  await page.route('**/api/v1/wardrobe/care?*', (r) =>
    r.fulfill({ json: envelope({ items: [careGarment(1)], next_cursor: null }) }),
  )
  return { audit, envelope }
}

test('location search keeps scope during slow results and offers keyboard-safe empty recovery', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 320, height: 568 })
  const { audit, envelope } = await setup(page)
  let release: (() => void) | undefined
  await page.route('**/api/v1/wardrobe/locations?*', async (r) => {
    const search = new URL(r.request().url()).searchParams.get('location_q')
    if (search)
      await new Promise<void>((resolve) => {
        release = resolve
      })
    await r.fulfill({
      json: envelope({
        items: search ? [] : [{ location: '衣柜', count: 25 }],
        total_garments: 30,
        unassigned_count: 5,
        matching_locations: search ? 0 : 1,
        next_cursor: null,
      }),
    })
  })
  await page.goto('/wardrobe?availability=unavailable')
  expect(
    (await page.getByRole('searchbox', { name: '搜索衣服' }).boundingBox())!.width,
  ).toBeGreaterThan(100)
  await page.getByRole('button', { name: '按收纳位置找衣服' }).click()
  await expect(page.getByRole('button', { name: '衣柜 25 件' })).toBeVisible()
  const search = page.getByRole('searchbox', { name: '搜索已有位置' })
  await search.fill('找不到')
  await expect(page.getByRole('button', { name: '衣柜 25 件' })).toBeDisabled()
  await expect(page.getByRole('button', { name: '全部位置 30 件' })).toBeVisible()
  await expect.poll(() => !!release).toBe(true)
  release!()
  await expect(page.getByText('没有匹配的位置', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '清空搜索，查看全部位置' }).click()
  await expect(search).toBeFocused()
  await expect(search).toHaveValue('')
  await expect(page.getByRole('button', { name: '衣柜 25 件' })).toBeEnabled()
  await page.getByRole('button', { name: '衣柜 25 件' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: '按收纳位置找衣服' }).click()
  await expect(page.getByRole('button', { name: '衣柜 25 件' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.screenshot({ path: info.outputPath('location-selected.png'), animations: 'disabled' })
  await page.goBack()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '按收纳位置找衣服' })).toBeFocused()
  expect(audit.writes).toEqual([])
  expect(audit.errors).toEqual([])
})

test('failed location pagination retains rows and retries the missing page', async ({ page }) => {
  const { audit, envelope } = await setup(page)
  let failed = true
  const cursors: (string | null)[] = []
  await page.route('**/api/v1/wardrobe/locations?*', (r) => {
    const cursor = new URL(r.request().url()).searchParams.get('cursor')
    cursors.push(cursor)
    if (cursor && failed)
      return r.fulfill({
        status: 503,
        json: { request_id: id(99), error: { code: 'TEMPORARY', message: '连接暂时中断' } },
      })
    return r.fulfill({
      json: envelope({
        items: [{ location: cursor ? '收纳箱' : '衣柜', count: 2 }],
        total_garments: 4,
        unassigned_count: 0,
        matching_locations: 2,
        next_cursor: cursor ? null : '衣柜',
      }),
    })
  })
  await page.goto('/wardrobe')
  await page.getByRole('button', { name: '按收纳位置找衣服' }).click()
  await page.getByRole('button', { name: '加载更多位置' }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByRole('button', { name: '衣柜 2 件' })).toBeEnabled()
  failed = false
  await page.getByRole('button', { name: '重试加载更多位置' }).click()
  await expect(page.getByRole('button', { name: '收纳箱 2 件' })).toBeVisible()
  expect(cursors.at(-1)).toBe('衣柜')
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(audit.writes).toEqual([])
})

test('reuse returns to visible manual input and supports long text with reduced motion', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 375, height: 667 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const { audit, envelope } = await setup(page)
  const long = '衣柜第二层收纳箱'.repeat(12)
  await page.route('**/api/v1/wardrobe/locations?*', (r) =>
    r.fulfill({
      json: envelope({
        items: [{ location: long, count: 2 }],
        total_garments: 2,
        unassigned_count: 0,
        matching_locations: 1,
        next_cursor: null,
      }),
    }),
  )
  await page.goto('/wardrobe/care?group=all')
  await page.getByRole('combobox', { name: '批量操作', exact: true }).selectOption('location_set')
  const input = page.getByLabel('新收纳位置')
  await input.fill('保留手工草稿')
  await page.getByRole('button', { name: '选择已有位置' }).click()
  await page.getByRole('button', { name: '返回手动填写' }).click()
  await expect(input).toHaveValue('保留手工草稿')
  await expect(input).toBeFocused()
  await page.getByRole('button', { name: '选择已有位置' }).click()
  await page.getByRole('button', { name: `${long} 2 件` }).click()
  await expect(input).toHaveValue(long)
  await expect(input).toBeFocused()
  const bounds = (await input.boundingBox())!
  expect(bounds.y).toBeGreaterThanOrEqual(0)
  expect(bounds.y + bounds.height).toBeLessThan(667 - 60)
  await expect(page.getByText('已填入位置，保存后生效。')).toBeVisible()
  await page.getByRole('button', { name: '选择已有位置' }).click()
  await page.addStyleTag({
    content:
      '.location-choices { font-size: 24px } .location-options .button { font-size: inherit }',
  })
  await page.locator('.location-current summary').click()
  await expect(page.locator('.location-current p')).toHaveText(long)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
  await page.screenshot({
    path: info.outputPath('location-reuse-large-text.png'),
    animations: 'disabled',
  })
  expect(audit.writes).toEqual([])
  expect(audit.errors).toEqual([])
})
