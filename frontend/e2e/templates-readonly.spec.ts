import { expect, test } from '@playwright/test'
test('deployed template reads and draft-only editor never write', async ({
  page,
  request,
}, info) => {
  const writes: string[] = []
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.route('**/api/v1/**', (r) => {
    if (r.request().method() === 'GET') return r.continue()
    writes.push(r.request().url())
    return r.abort()
  })
  await page.route('**/api/v1/profile/location', (r) =>
    r.fulfill({
      json: {
        data: { city: null, version: 1 },
        request_id: '00000000-0000-4000-8000-000000000001',
      },
    }),
  )
  const response = await request.get('/api/v1/condition-templates')
  expect(response.ok()).toBeTruthy()
  const rows = (await response.json()).data
  expect(Array.isArray(rows)).toBe(true)
  await page.goto('/outfits/prepare')
  await page.getByRole('button', { name: '条件模板', exact: true }).click()
  if (rows.length)
    await expect(
      page.getByRole('button', {
        name: `${rows[0].name} ${rows[0].issues.length ? '需要修正' : '查看与选用'}`,
      }),
    ).toBeVisible()
  else await expect(page.getByText('还没有模板。可先将当前条件保存下来。')).toBeVisible()
  await page.getByRole('button', { name: '将当前条件另存为模板' }).click()
  await page.getByLabel('模板名称').fill('只读验收草稿')
  await page.screenshot({ path: info.outputPath('deployed-template.png'), animations: 'disabled' })
  await page.getByRole('button', { name: '关闭面板' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(writes).toEqual([])
  expect(errors).toEqual([])
})
