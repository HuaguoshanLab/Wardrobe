import { expect, test } from '@playwright/test'

const id = '00000000-0000-4000-8000-000000000081'
const envelope = (data: unknown) => ({ data, request_id: id })
test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/**', (route) =>
    route.request().method() === 'GET' ? route.continue() : route.abort('blockedbyclient'),
  )
})

test('settings preferences protect edits and city returns to conditions without writes', async ({
  page,
}, info) => {
  const writes: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/api/v1/') && request.method() !== 'GET') writes.push(request.url())
  })
  await page.goto('/settings')
  await expect(page.locator('.settings-menu-row')).toHaveCount(4)
  await page.screenshot({ path: info.outputPath('settings.png'), fullPage: true })
  await page.getByRole('link', { name: '穿衣偏好', exact: true }).click()
  await expect(page.getByRole('button', { name: '保存偏好', exact: true })).toBeDisabled()
  await page.getByLabel('偏好补充').fill('本次未保存的输入')
  await page.getByRole('link', { name: '返回设置' }).click()
  await expect(page.getByRole('dialog', { name: '放弃未保存的修改？' })).toBeVisible()
  await page.getByRole('button', { name: '继续编辑' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByLabel('偏好补充')).toHaveValue('本次未保存的输入')
  await page.screenshot({ path: info.outputPath('preferences.png'), fullPage: true })
  await page.getByRole('link', { name: '返回设置' }).click()
  await page.getByRole('button', { name: '确认放弃' }).click()
  await expect(page).toHaveURL(/\/settings$/)
  await page.goto('/outfits/prepare')
  await page.getByLabel('本次补充要求').fill('保留条件草稿')
  await page.getByText(/^天气与城市/).click()
  await page.getByRole('link', { name: /更换城市/ }).click()
  await expect(page.getByRole('link', { name: '返回搭配条件' })).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('手填城市')).not.toBeVisible()
  await page.getByText('找不到城市？手动填写').click()
  await expect(page.getByLabel('手填城市')).toBeVisible()
  await page.screenshot({ path: info.outputPath('location.png'), fullPage: true })
  await page.getByRole('button', { name: '清空默认城市', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '清空默认城市？' })).toBeVisible()
  await page.screenshot({ path: info.outputPath('clear-city.png') })
  await page.getByRole('button', { name: '保留城市' }).click()
  await page.getByRole('link', { name: '返回搭配条件' }).click()
  await expect(page.getByLabel('本次补充要求')).toHaveValue('保留条件草稿')
  expect(writes).toEqual([])
})

test('settings subpages fit mobile and service loading never claims unconfigured', async ({
  page,
}, info) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  for (const path of ['preferences', 'location', 'backups', 'services']) {
    await page.goto(`/settings/${path}`)
    await expect(page.locator('main h1')).toBeVisible()
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true)
    if (path === 'services') {
      await expect(page.getByRole('heading', { name: '图片去背景' })).toBeVisible()
      await page.getByText('高级工具 · 环境诊断').click()
    }
    await page.screenshot({ path: info.outputPath(`${path}-page.png`), fullPage: true })
  }
  await page.route('**/api/v1/capabilities', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 600))
    await route.fulfill({
      status: 503,
      json: { error: { code: 'UNAVAILABLE', message: '测试读取失败' } },
    })
  })
  await page.reload()
  await expect(page.getByText('正在读取服务状态…')).toBeVisible()
  await expect(page.getByText('未配置', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('alert').filter({ hasText: '无法读取服务状态' })).toBeVisible({
    timeout: 15000,
  })
  expect(errors).toEqual([])
})

test('restore requires reviewed confirmation and city retries identical save after reload with mocked writes', async ({
  page,
}, info) => {
  const writes: { body: string | null; key: string | undefined }[] = []
  let attempts = 0
  let savedCity: unknown = null
  await page.route('**/api/v1/profile/location', async (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({ json: envelope({ city: savedCity, version: savedCity ? 4 : 3 }) })
    writes.push({
      body: route.request().postData(),
      key: route.request().headers()['idempotency-key'],
    })
    attempts++
    if (attempts === 1) return route.abort('failed')
    savedCity = route.request().postDataJSON().city
    return route.fulfill({
      json: envelope({ city: savedCity, version: 4 }),
    })
  })
  await page.goto('/outfits/prepare')
  await page.getByLabel('本次补充要求').fill('更换城市也保留这段要求')
  await page.getByText(/^天气与城市/).click()
  await page.getByLabel('天气来源').selectOption('manual')
  await page.getByLabel('手动温度（℃）').fill('0')
  await page.getByLabel('天气现象').fill('雪')
  await page.getByRole('link', { name: /更换城市/ }).click()
  await page.getByText('找不到城市？手动填写').click()
  await page.getByLabel('省级地区').selectOption('浙江省')
  await page.getByLabel('手填城市').fill('杭州')
  await page.getByRole('button', { name: '保存手填城市' }).click()
  await expect(page.getByRole('button', { name: '重试保存' })).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('手填城市')).toHaveValue('杭州')
  expect(writes).toHaveLength(1)
  await page.getByRole('button', { name: '重试保存' }).click()
  await expect(page.getByText('默认城市已保存')).toBeVisible()
  expect(writes[0]).toEqual(writes[1])
  await page.getByRole('link', { name: '返回搭配条件' }).click()
  await expect(page.getByLabel('本次补充要求')).toHaveValue('更换城市也保留这段要求')
  await page.getByText(/^天气与城市/).click()
  await expect(page.getByLabel('天气来源')).toHaveValue('qweather')
  await expect(page.getByLabel('手动温度（℃）')).toHaveCount(0)
  await page.evaluate((id) => localStorage.setItem('wardrobe-control.restore', id), id)
  await page.route('**/api/v1/restores/*', (route) =>
    route.fulfill({
      json: envelope({
        restore_id: id,
        status: 'ready',
        message: '验证通过',
        sha256: 'test-hash',
        confirmation_token: 'test-token',
        expires_at: '2099-01-01T00:00:00Z',
        target_data_epoch: id,
        summary: { 'public.garments': 12, 'public.favorites': 3 },
        job_id: null,
      }),
    }),
  )
  let applies = 0
  await page.route('**/api/v1/restores/*/apply', (route) => {
    applies++
    return route.fulfill({ json: envelope({ job_id: id, status: 'queued' }) })
  })
  await page.goto('/settings/backups')
  await page.getByRole('button', { name: '检查并恢复' }).click()
  await expect(page.getByRole('button', { name: '确认覆盖恢复' })).toBeDisabled()
  expect(applies).toBe(0)
  await page.screenshot({ path: info.outputPath('restore-confirm-mocked.png') })
  await page.getByRole('checkbox', { name: '我确认用此备份覆盖当前业务数据' }).check()
  await page.getByRole('button', { name: '确认覆盖恢复' }).click()
  await expect.poll(() => applies).toBe(1)
})
