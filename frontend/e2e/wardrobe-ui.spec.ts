import { expect, test } from '@playwright/test'

const id = '00000000-0000-4000-8000-000000000001'
const envelope = (data: unknown) => ({ data, request_id: id })
const base = {
  id,
  image_asset_id: id,
  version: 1,
  created_at: '',
  image_url: '/api/v1/media/mock?variant=original',
  has_cutout: true,
  is_demo: false,
  category: 'tops',
  name: '白衬衫',
  color_codes: [],
  seasons: [],
  occasion_codes: [],
  style_codes: [],
  material: null,
  thickness: null,
  warmth: null,
  custom_tag_ids: [],
  availability: 'available',
  display_variant: 'original',
}
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="300"><rect width="240" height="300" fill="#f0f1e9"/><path d="M70 50 20 80 40 130 65 115 65 250 175 250 175 115 200 130 220 80 170 50 140 65 100 65Z" fill="white" stroke="#d4d9cc" stroke-width="2"/></svg>'

test.beforeEach(async ({ page }) => {
  // All wardrobe writes are fulfilled locally; no user garments or paid providers are touched.
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    if (path.includes('/media/')) return route.fulfill({ contentType: 'image/svg+xml', body: svg })
    if (path.endsWith('/taxonomies'))
      return route.fulfill({
        json: envelope({
          version: 1,
          fields: {
            category: { tops: '上衣', pants: '裤子' },
            seasons: { spring: '春季', winter: '冬季' },
            color_codes: { white: '白色', black: '黑色' },
            occasion_codes: { daily: '日常', commute: '通勤' },
          },
        }),
      })
    if (path.endsWith('/tags')) return route.fulfill({ json: envelope([]) })
    if (path.endsWith('/garments')) {
      const second = url.searchParams.has('cursor')
      return route.fulfill({
        json: envelope({
          items: Array.from({ length: second ? 4 : 20 }, (_, n) => ({
            ...base,
            id: `00000000-0000-4000-8000-${String(n + (second ? 21 : 1)).padStart(12, '0')}`,
            name: `衣服 ${n + (second ? 21 : 1)}`,
          })),
          next_cursor: second ? null : id,
        }),
      })
    }
    if (path.includes('/garments/')) {
      if (route.request().method() === 'PATCH')
        return route.fulfill({
          json: envelope({ ...base, ...route.request().postDataJSON().changes, version: 2 }),
        })
      if (route.request().method() === 'DELETE') return route.fulfill({ status: 204 })
      return route.fulfill({ json: envelope(base) })
    }
    return route.request().method() === 'GET' ? route.continue() : route.abort('blockedbyclient')
  })
})

test('load more and return retain cards and scroll; filters have independent resets', async ({
  page,
}) => {
  await page.goto('/wardrobe?category=tops&season=spring&availability=available')
  await expect(page.locator('.garment-card')).toHaveCount(20)
  await page.getByRole('button', { name: '加载更多' }).click()
  await expect(page.locator('.garment-card')).toHaveCount(24)
  await page.locator('.garment-card').last().scrollIntoViewIfNeeded()
  const before = await page
    .getByRole('region', { name: '衣橱列表' })
    .evaluate((element) => element.scrollTop)
  await page.locator('.garment-card').last().click()
  await page.getByRole('link', { name: '返回衣橱' }).click()
  await expect(page.locator('.garment-card')).toHaveCount(24)
  await expect
    .poll(() =>
      page.getByRole('region', { name: '衣橱列表' }).evaluate((element) => element.scrollTop),
    )
    .toBe(before)
  await page.getByRole('button', { name: /^筛选/ }).click()
  await page.getByRole('button', { name: '重置更多筛选' }).click()
  await page.getByRole('button', { name: '查看结果', exact: true }).click()
  await expect(page).toHaveURL(/category=tops&season=spring$/)
  await page.getByRole('button', { name: '移除筛选：春季' }).click()
  await expect(page).toHaveURL(/category=tops$/)
})

test('detail preview, editor, discard and deletion sheets remain usable', async ({
  page,
}, testInfo) => {
  const writes: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/garments/') && request.method() !== 'GET')
      writes.push(request.method())
  })
  await page.goto(`/wardrobe/${id}`)
  await expect(page.getByRole('heading', { name: '白衬衫', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '去背景', exact: true }).click()
  await expect(page.getByRole('button', { name: '设为默认展示图' })).toBeVisible()
  expect(writes).toEqual([])
  await page.getByRole('button', { name: '放大查看图片' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: '关闭面板', exact: true }).click()
  await page.screenshot({
    path: testInfo.outputPath('detail.png'),
    fullPage: true,
    animations: 'disabled',
  })
  await page.getByRole('button', { name: '编辑单品信息' }).click()
  await page.getByRole('button', { name: '白色', exact: true }).click()
  await page.getByLabel('品类', { exact: true }).selectOption('')
  await page.getByRole('button', { name: '保存修改' }).click()
  await expect(page.getByRole('alert')).toContainText('请选择品类')
  await page.getByLabel('品类', { exact: true }).selectOption('tops')
  await page.getByRole('link', { name: '返回衣橱' }).click()
  await expect(page.getByRole('dialog')).toContainText('放弃未保存的修改')
  await page.getByRole('button', { name: '继续编辑' }).click()
  await expect(page.getByLabel('名称', { exact: true })).toBeFocused()
  await page.screenshot({
    path: testInfo.outputPath('editor.png'),
    fullPage: true,
    animations: 'disabled',
  })
  await page.getByRole('button', { name: '保存修改' }).click()
  await expect(page.getByRole('status')).toHaveText('已保存')
  expect(writes).toEqual(['PATCH'])
  await page.getByRole('button', { name: '删除这件单品' }).click()
  await expect(page.getByRole('dialog')).toContainText('历史穿搭及其图片仍会保留')
  await page.screenshot({
    path: testInfo.outputPath('delete.png'),
    fullPage: true,
    animations: 'disabled',
  })
  await page.getByRole('button', { name: '保留单品' }).click()
  expect(writes).toEqual(['PATCH'])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('button', { name: '删除这件单品' }).click()
  await page.getByRole('button', { name: '确认删除单品' }).click()
  await expect(page).toHaveURL('/wardrobe')
  expect(writes).toEqual(['PATCH', 'DELETE'])
})
