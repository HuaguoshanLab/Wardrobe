import { expect, test } from '@playwright/test'

test('explicit diagnostic completes and survives a page reload without a new POST', async ({
  page,
}) => {
  let submissions = 0
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/diagnostics/jobs')) submissions++
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '今日穿搭', exact: true })).toBeVisible()
  expect(submissions).toBe(0)
  await page.getByRole('link', { name: '设置', exact: true }).click()
  await expect(page.getByText('明确的模拟环境，不请求千问。')).toBeVisible()
  await page.getByRole('button', { name: '运行模拟任务' }).click()
  await expect(page.getByText('任务状态：已完成')).toBeVisible({ timeout: 20000 })
  const result = await page.locator('.task-result').innerText()
  await page.reload()
  await expect(page.getByText('任务状态：已完成')).toBeVisible()
  expect(await page.locator('.task-result').innerText()).toBe(result)
  expect(submissions).toBe(1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
})
