import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'

test('isolated browser restore confirms replacement, resumes control progress and clears stale browser state', async ({
  page,
  request,
}, testInfo) => {
  // This scenario runs only against the separate stack configured on port 8099.
  expect(testInfo.project.use.baseURL).toBe('http://localhost:8099')
  const original = (await (await request.get('/api/v1/profile/preferences')).json()).data
  const epoch = (await (await request.get('/api/v1/capabilities')).json()).data.data_epoch
  await page.goto('/settings/backups')
  await page.getByRole('button', { name: '创建完整备份' }).click()
  const download = page.getByRole('link', { name: /下载备份 ZIP/ })
  await expect(download).toBeVisible({ timeout: 60000 })
  const bytes = await (await request.get((await download.getAttribute('href'))!)).body()
  const changed = await request.patch('/api/v1/profile/preferences', {
    headers: { 'Idempotency-Key': randomUUID() },
    data: {
      expected_version: original.version,
      preferences: { notes: 'P5 isolated state to replace' },
    },
  })
  expect(changed.ok()).toBe(true)
  await page
    .getByLabel('备份文件', { exact: true })
    .setInputFiles({ name: 'isolated.zip', mimeType: 'application/zip', buffer: bytes })
  await page.getByRole('button', { name: '上传并验证', exact: true }).click()
  await page.getByRole('button', { name: '检查并恢复' }).click({ timeout: 60000 })
  const apply = page.getByRole('button', { name: '确认覆盖恢复' })
  await expect(apply).toBeVisible({ timeout: 60000 })
  await expect(apply).toBeDisabled()
  await page.evaluate(() =>
    localStorage.setItem('wardrobe.test-stale-operation', 'must be cleared'),
  )
  await page.getByRole('checkbox', { name: '我确认用此备份覆盖当前业务数据' }).check()
  await apply.click()
  await page.reload()
  await expect
    .poll(async () => (await (await request.get('/api/v1/capabilities')).json()).data.data_epoch, {
      timeout: 60000,
    })
    .not.toBe(epoch)
  await expect(
    page.getByText(
      '恢复完成，应用已清理旧缓存。可以返回衣橱查看恢复的数据，之前的任务不会自动运行。',
    ),
  ).toBeVisible({ timeout: 30000 })
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('wardrobe.test-stale-operation')), {
      timeout: 30000,
    })
    .toBeNull()
  expect(
    (await (await request.get('/api/v1/profile/preferences')).json()).data.preferences,
  ).toEqual(original.preferences)
  await page.screenshot({ path: testInfo.outputPath('p5-restored.png'), fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
