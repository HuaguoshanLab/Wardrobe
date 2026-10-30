import { expect, test } from '@playwright/test'
import { mockAudit, revision, id } from './content-audit-fixtures'

for (const [width, height] of [
  [320, 568],
  [375, 667],
  [844, 390],
  [1280, 900],
]) {
  test(`rotation choices and evidence at ${width}×${height}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const rev = revision(1)
    rev.items[0].attributes.name = '日常上衣'
    rev.reason = '保留的完整说明。'
    const base = {
      mode: 'less_worn',
      as_of: '2026-10-30',
      start: '2026-10-01',
      record_count: 8,
      record_days: 5,
      full_repeat: false,
      body_repeat: false,
      message: '按实际记录比较；同一单品同一天只计一次。',
      items: Array.from({ length: 20 }, (_, i) => ({
        garment_id: id(100 + i),
        name: i === 0 ? 'LongGarmentNameWithoutSpaces'.repeat(8) : `日常单品 ${i + 1}`,
        wear_days: i % 10,
      })),
    }
    rev.request_snapshot.rotation = base
    const audit = await mockAudit(page, rev)
    await page.goto('/outfits/prepare')
    await expect(page.getByRole('radio', { name: /正常推荐/ })).toBeVisible()
    await page.getByRole('radio', { name: /正常推荐/ }).focus()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('radio', { name: /尽量避开近期组合/ })).toBeChecked()
    await page.reload()
    await expect(page.getByRole('radio', { name: /尽量避开近期组合/ })).toBeChecked()
    const choice = page.locator('.rotation-choice')
    await choice.screenshot({ path: info.outputPath('choices.png') })
    for (const label of await page.locator('.rotation-option').all())
      expect((await label.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    await page.goto('/')
    const evidence = page.getByRole('region', { name: '轮换依据' })
    await expect(evidence).toBeVisible()
    await expect(evidence.locator('dl')).not.toBeVisible()
    expect((await evidence.boundingBox())!.height).toBeLessThan(360)
    await evidence.screenshot({ path: info.outputPath('summary.png') })
    const summary = evidence.locator('summary')
    await summary.scrollIntoViewIfNeeded()
    await summary.focus()
    const bounds = await summary.boundingBox()
    const nav = await page.locator('.sidebar').boundingBox()
    if (width <= 760) expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(nav!.y)
    await page.keyboard.press('Enter')
    await expect(evidence.locator('dt')).toHaveCount(20)
    await expect(evidence.getByText(base.items[0].name)).toBeVisible()
    expect(await evidence.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
    await page.addStyleTag({
      content:
        '.rotation-evidence { font-size: 20px } .rotation-evidence p, .rotation-evidence dt, .rotation-evidence dd, .rotation-evidence summary { font-size: 20px }',
    })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await summary.focus()
    await page.keyboard.press('Enter')
    await expect(evidence.locator('dl')).not.toBeVisible()
    rev.request_snapshot.rotation = { ...base, mode: 'avoid_recent', body_repeat: true, items: [] }
    rev.request_snapshot.intent = { scope: 'replace_items' }
    await page.goto(`/collections/${rev.id}`)
    await expect(evidence.getByRole('heading', { name: '主体组合近期穿过' })).toBeVisible()
    await expect(evidence.getByText('仅比较替换项，其余单品保持')).toBeVisible()
    await evidence.screenshot({ path: info.outputPath('repeat.png') })
    rev.request_snapshot.rotation = { ...base, record_count: 0, record_days: 0, items: [] }
    await page.reload()
    await expect(evidence.getByRole('heading', { name: '暂无近期穿着记录' })).toBeVisible()
    await evidence.getByRole('link', { name: '查看穿着记录' }).click()
    await expect(page).toHaveURL(/collections\?view=calendar/)
    expect(audit.writes).toEqual([])
    expect(audit.errors).toEqual([])
  })
}
