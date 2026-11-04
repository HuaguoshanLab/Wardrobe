import { expect, test } from '@playwright/test'
import { id, mockAudit, revision } from './content-audit-fixtures'

for (const reducedMotion of ['reduce', 'no-preference'] as const) {
  test(`template slow reads, explicit selection and stable focus (${reducedMotion})`, async ({
    page,
  }, info) => {
    await page.emulateMedia({ reducedMotion })
    const audit = await mockAudit(page, revision(), true)
    const envelope = (data: unknown) => ({ data, request_id: id(99) })
    await page.route('**/api/v1/profile/location', (r) =>
      r.fulfill({ json: envelope({ city: null, version: 1 }) }),
    )
    const template = {
      id: id(71),
      name: '轻便通勤',
      conditions: {
        occasion_codes: ['work'],
        style_codes: null,
        custom_tag_ids: [],
        notes: '保持轻便',
        rotation_mode: 'less_worn',
      },
      version: 1,
      created_at: '2026-11-04',
      updated_at: '2026-11-04',
      issues: [],
    }
    let release: (() => void) | undefined
    let slow = true
    await page.route('**/api/v1/condition-templates**', async (r) => {
      if (r.request().method() !== 'GET') return r.abort()
      const list = new URL(r.request().url()).pathname.endsWith('/condition-templates')
      if (!list && slow)
        await new Promise<void>((resolve) => {
          release = resolve
        })
      await r.fulfill({ json: envelope(list ? [template] : template) })
    })
    await page.goto('/outfits/prepare')
    await page.getByRole('button', { name: '条件模板', exact: true }).click()
    const row = page.getByRole('button', { name: '轻便通勤 查看与选用' })
    await row.click()
    await expect(page.getByText('正在处理，请稍候…', { exact: true })).toBeVisible()
    await expect(row).toBeDisabled()
    await expect.poll(() => !!release).toBe(true)
    slow = false
    release!()
    await expect(page.getByRole('heading', { name: '轻便通勤', exact: true })).toBeFocused()
    await page.getByRole('button', { name: '返回模板列表' }).click()
    await expect(row).toBeFocused()
    await row.click()
    await page.getByRole('button', { name: '确认替换当前条件' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const notice = page.getByText('已选用“轻便通勤”，请核对天气后再生成。', { exact: true })
    await expect(notice).toBeFocused()
    await page.waitForTimeout(300) // Check after normal Sheet exit animation, not only during close.
    await expect(notice).toBeFocused()
    await expect(page.getByLabel('本次补充要求')).toHaveValue('保持轻便')
    expect(audit.writes).toEqual([])
    expect(audit.errors).toEqual([])
    await page.screenshot({
      path: info.outputPath('template-applied-focus.png'),
      animations: 'disabled',
    })
  })
}
