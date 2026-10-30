import { expect, test } from '@playwright/test'
import { mockAudit, revision, id } from './content-audit-fixtures'

for (const [width, height] of [
  [320, 568],
  [375, 667],
  [844, 390],
  [1280, 900],
]) {
  test(`feedback layout and explicit controls ${width}×${height}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const rev = revision(3)
    rev.items[0].attributes.name = '长名称'.repeat(30)
    const audit = await mockAudit(page, rev)
    const wear = {
      id: id(80),
      revision_id: rev.id,
      revision: rev,
      worn_on: '2026-10-30',
      timezone: 'Asia/Shanghai',
      notes: '',
      version: 1,
      created_at: '2026-10-30T00:00:00Z',
    }
    await page.route(`**/api/v1/wear-records/${wear.id}`, (route) =>
      route.fulfill({ json: { data: wear, request_id: id(90) } }),
    )
    await page.route(`**/api/v1/wear-records/${wear.id}/feedback`, (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            json: {
              data: {
                wear_record_id: wear.id,
                version: 1,
                feedback: {
                  garment_id: null,
                  thermal: 'hot',
                  comfort: 'neutral',
                  color: 'satisfied',
                  notes: '午后偏热',
                },
                updated_at: '2026-10-30T00:00:00Z',
              },
              request_id: id(90),
            },
          })
        : route.abort(),
    )
    await page.goto(`/collections/wear/${wear.id}/feedback`)
    await expect(page.getByRole('heading', { name: '穿后反馈', exact: true })).toBeVisible()
    await expect(page.getByRole('radio', { name: '偏热', exact: true })).toBeChecked()
    await page.screenshot({ path: info.outputPath('feedback-form.png'), fullPage: true })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    for (const label of await page.locator('.feedback-choices label').all())
      expect((await label.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    await page.getByRole('button', { name: '用于下次搭配', exact: true }).click()
    await page.getByLabel('下次搭配参考').fill('下次想穿轻薄一些')
    await page.getByRole('button', { name: '保存为长期偏好', exact: true }).click()
    await expect(page.getByLabel('长期偏好补充')).toBeVisible()
    await page.getByLabel('长期偏好补充').fill('长期偏好由我核对')
    await page.getByRole('button', { name: '用于下次搭配', exact: true }).click()
    await expect(page.getByLabel('下次搭配参考')).toHaveValue('下次想穿轻薄一些')
    await page.getByRole('button', { name: '保存为长期偏好', exact: true }).click()
    await expect(page.getByLabel('长期偏好补充')).toHaveValue('长期偏好由我核对')
    const button = page.getByRole('button', { name: '确认保存长期偏好' })
    await button.scrollIntoViewIfNeeded()
    await button.focus()
    const bounds = (await button.boundingBox())!
    const nav = (await page.locator('.sidebar').boundingBox())!
    if (width <= 760) expect(bounds.y + bounds.height).toBeLessThanOrEqual(nav.y)
    await page.screenshot({ path: info.outputPath('feedback-preference.png'), fullPage: true })
    await page.addStyleTag({
      content:
        '.feedback-page {font-size:20px} .feedback-page p, .feedback-page label {font-size:20px}',
    })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page
      .getByRole('combobox', { name: '反馈对象', exact: true })
      .selectOption(rev.items[0].garment_id!)
    await expect(page.locator('.feedback-target')).toContainText('长名称'.repeat(30))
    await expect(button).toBeDisabled()
    await page.getByRole('button', { name: '清除冷热感受' }).click()
    await expect(page.getByRole('radio', { name: '偏热', exact: true })).not.toBeChecked()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(audit.writes).toEqual([])
    expect(audit.errors).toEqual([])
  })
}
