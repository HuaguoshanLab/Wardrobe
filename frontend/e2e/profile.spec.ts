import { expect, test } from '@playwright/test'

test('preferences, manual city and zero-degree conditions persist without model calls', async ({
  page,
  request,
}, testInfo) => {
  const preferences = (await (await request.get('/api/v1/profile/preferences')).json()).data
  const location = (await (await request.get('/api/v1/profile/location')).json()).data
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  let modelPosts = 0
  page.on('request', (req) => {
    if (req.method() === 'POST' && /diagnostics\/jobs|\/generate|\/adjust|\/retry/.test(req.url()))
      modelPosts++
  })
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'geolocation', {
      value: {
        getCurrentPosition: (_ok: unknown, fail: (error: object) => void) => fail({ code: 1 }),
      },
    })
  })
  try {
    await page.goto('/settings/preferences')
    await page.getByLabel('偏好补充').fill('P3 E2E 明确填写')
    await page.getByLabel('版型').selectOption('loose')
    const saves: { body: string | null; key: string | undefined }[] = []
    let committedVersion: number | undefined
    await page.route('**/api/v1/profile/preferences', async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue()
      saves.push({
        body: route.request().postData(),
        key: route.request().headers()['idempotency-key'],
      })
      if (saves.length === 1) {
        const response = await route.fetch()
        committedVersion = (await response.json()).data.version
        await route.abort('failed') // Commit succeeded, but the browser never receives the response.
      } else {
        await route.continue()
      }
    })
    await page.getByRole('button', { name: '保存偏好', exact: true }).click()
    await expect(page.getByRole('button', { name: '重发原保存操作' })).toBeVisible()
    await page.reload()
    await expect(page.getByLabel('偏好补充')).toHaveValue('P3 E2E 明确填写')
    expect(saves).toHaveLength(1)
    await page.getByRole('button', { name: '重发原保存操作' }).click()
    await expect(page.getByText('偏好已保存', { exact: true })).toBeVisible()
    expect(saves).toHaveLength(2)
    expect(saves[1]).toEqual(saves[0])
    const recovered = (await (await request.get('/api/v1/profile/preferences')).json()).data
    expect(recovered.version).toBe(committedVersion)
    await page.unroute('**/api/v1/profile/preferences')
    await page.getByRole('link', { name: '返回设置' }).click()
    await page.getByRole('link', { name: '默认城市', exact: true }).click()
    await page.getByRole('button', { name: '使用当前位置' }).click()
    await expect(page.getByRole('status').filter({ hasText: '定位失败或未授权' })).toBeVisible()
    await page.getByLabel('省级地区').selectOption('浙江省')
    await page.getByLabel('手填城市').fill('杭州')
    await page.getByRole('button', { name: '保存手填城市' }).click()
    await expect(page.getByText('默认城市已保存')).toBeVisible()
    await page.reload()
    await expect(page.getByText('浙江省 · 杭州（手动填写，位置未核验）')).toBeVisible()
    await page.goto('/settings/preferences')
    await expect(page.getByLabel('偏好补充')).toHaveValue('P3 E2E 明确填写')
    await expect(page.getByLabel('版型')).toHaveValue('loose')
    await page.getByRole('link', { name: '今日穿搭', exact: true }).click()
    await page.getByRole('link', { name: /^(换一套|准备搭配)$/ }).click()
    await page.getByText(/^更多条件/).click()
    await page.getByLabel('风格来源').selectOption('override')
    await page.getByLabel('天气来源').selectOption('manual')
    await page.getByLabel('手动温度（℃）').fill('0')
    await page.getByLabel('天气现象').fill('小雪')
    await page.getByRole('button', { name: '保存并核对条件' }).click()
    await expect(page.getByText('手动天气：0℃ · 小雪')).toBeVisible()
    await page.reload()
    await expect(page.getByLabel('手动温度（℃）')).toHaveValue('0')
    await expect(page.getByLabel('天气现象')).toHaveValue('小雪')
    expect(modelPosts).toBe(0)
    expect(pageErrors).toEqual([])
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('p3-home.png'), fullPage: true })
    await page.getByText(/^天气与城市/).click()
    await page.getByRole('link', { name: '更换城市' }).click()
    await page.getByLabel('省级地区').selectOption('江苏省')
    await page.getByLabel('手填城市').fill('南京')
    await page.getByRole('button', { name: '保存手填城市' }).click()
    await expect(page.getByText('默认城市已保存')).toBeVisible()
    await page.getByRole('link', { name: '今日穿搭', exact: true }).click()
    await page.getByRole('link', { name: /^(换一套|准备搭配)$/ }).click()
    await expect(page.getByLabel('天气来源')).toHaveValue('qweather')
    await expect(page.getByLabel('手动温度（℃）')).toHaveCount(0)
  } finally {
    // Restore only the two profiles modified by this test, using their latest versions.
    for (const [path, field, original] of [
      ['preferences', 'preferences', preferences.preferences],
      ['location', 'city', location.city],
    ] as const) {
      const latest = (await (await request.get(`/api/v1/profile/${path}`)).json()).data
      const result = await request.patch(`/api/v1/profile/${path}`, {
        headers: { 'Idempotency-Key': `restore-${path}-${Date.now()}-${testInfo.project.name}` },
        data: { expected_version: latest.version, [field]: original },
      })
      expect(result.ok()).toBe(true)
    }
  }
})
