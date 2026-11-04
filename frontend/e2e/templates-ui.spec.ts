import { expect, test } from '@playwright/test'
import { id, mockAudit, revision } from './content-audit-fixtures'
for (const [width, height] of [
  [320, 568],
  [375, 667],
  [844, 390],
  [1280, 900],
]) {
  test(`template preview, drafts and explicit correction ${width}x${height}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height })
    const audit = await mockAudit(page, revision(), true)
    const envelope = (data: unknown) => ({ data, request_id: id(99) })
    await page.route('**/api/v1/profile/location', (r) =>
      r.fulfill({ json: envelope({ city: null, version: 1 }) }),
    )
    const name = '日常通勤和周末出行'.repeat(5)
    const t = {
      id: id(71),
      name,
      conditions: {
        occasion_codes: ['work'],
        style_codes: null,
        custom_tag_ids: [] as string[],
        notes: '长说明'.repeat(100),
        rotation_mode: 'less_worn',
      },
      version: 1,
      created_at: '2026-11-04',
      updated_at: '2026-11-04',
      issues: [] as string[],
    }
    let fail = false
    await page.route('**/api/v1/condition-templates**', (r) => {
      if (r.request().method() !== 'GET') return r.abort()
      if (fail)
        return r.fulfill({
          status: 503,
          json: { request_id: id(99), error: { code: 'TEMPORARY', message: '暂时无法读取模板' } },
        })
      return r.fulfill({
        json: envelope(
          new URL(r.request().url()).pathname.endsWith('/condition-templates') ? [t] : t,
        ),
      })
    })
    await page.goto('/outfits/prepare')
    await page.getByLabel('本次补充要求').fill('保留当前草稿')
    await page.getByRole('button', { name: '条件模板', exact: true }).click()
    await page.getByLabel('搜索模板').fill('找不到')
    await expect(page.getByText('没有匹配模板，试试其他关键词。')).toBeVisible()
    await page.getByRole('button', { name: '清空搜索' }).click()
    await expect(page.getByLabel('搜索模板')).toBeFocused()
    await page.getByRole('button', { name: `${name} 查看与选用` }).click()
    await expect(page.getByRole('button', { name: '确认替换当前条件' })).toBeEnabled()
    await expect(page.getByRole('heading', { name, exact: true })).toBeFocused()
    const action = await page.getByRole('button', { name: '确认替换当前条件' }).boundingBox()
    expect(action!.y + action!.height).toBeLessThanOrEqual(height)
    await page.getByText('展开完整补充要求（300 字）', { exact: true }).click()
    await expect(page.getByText('长说明'.repeat(100), { exact: true })).toBeVisible()
    await page.getByText('展开完整补充要求（300 字）', { exact: true }).click()
    await page.getByRole('button', { name: '删除模板', exact: true }).click()
    await page.getByRole('button', { name: '取消删除' }).click()
    await expect(page.getByRole('button', { name: '确认替换当前条件' })).toBeEnabled()
    await page.screenshot({ path: info.outputPath('template-preview.png'), animations: 'disabled' })
    await page.getByRole('button', { name: '返回模板列表' }).click()
    await expect(page.getByRole('button', { name: `${name} 查看与选用` })).toBeFocused()
    await page.getByRole('button', { name: '将当前条件另存为模板' }).click()
    await expect(page.getByRole('heading', { name: '另存为模板', exact: true })).toBeFocused()
    await page.getByLabel('模板名称').fill('未保存的模板')
    await page.getByRole('button', { name: '关闭面板' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByLabel('本次补充要求')).toHaveValue('保留当前草稿')
    await page.reload()
    await page.getByRole('button', { name: '条件模板', exact: true }).click()
    await page.getByRole('button', { name: '继续编辑草稿' }).click()
    await expect(page.getByLabel('模板名称')).toHaveValue('未保存的模板')
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    )
    await page.screenshot({ path: info.outputPath('template-editor.png'), animations: 'disabled' })
    await page.getByRole('button', { name: '返回列表，保留草稿' }).click()
    await page.getByRole('button', { name: '放弃模板编辑草稿' }).click()
    await expect(page.getByLabel('搜索模板')).toBeFocused()
    fail = true
    await page.getByRole('button', { name: '关闭面板' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.getByRole('button', { name: '条件模板', exact: true }).click()
    await expect(page.getByRole('alert')).toBeVisible()
    fail = false
    await page.getByRole('button', { name: '重新读取模板' }).click()
    await expect(page.getByRole('alert')).toHaveCount(0)
    t.issues = ['模板标签失效']
    t.conditions.custom_tag_ids = [id(81)]
    await page.getByRole('button', { name: `${name} 查看与选用` }).click()
    await expect(page.getByRole('button', { name: '确认替换当前条件' })).toBeDisabled()
    await page.getByRole('button', { name: '编辑模板', exact: true }).click()
    await expect(page.getByRole('button', { name: '保存模板', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: '移除失效条件' }).click()
    await expect(page.getByRole('button', { name: '保存模板', exact: true })).toBeEnabled()
    expect(audit.writes).toEqual([])
    expect(audit.errors).toEqual([])
  })
}
