import { expect, test, type Page } from '@playwright/test'
import { mockAudit, revision, longName, longNotes, id } from './content-audit-fixtures'

async function noOverflow(page: Page) {
  expect
    .soft(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      'document horizontal overflow',
    )
    .toBe(true)
  const dialog = page.getByRole('dialog')
  if (await dialog.count()) {
    await expect(dialog).toHaveCSS('opacity', '1')
    expect
      .soft(
        await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
        'dialog horizontal overflow',
      )
      .toBe(true)
    await expect.soft(dialog.getByRole('button', { name: '关闭面板' })).toBeInViewport()
  }
}

async function weatherFits(page: Page) {
  const bounds = await page.locator('.stage-weather').evaluate((el) => {
    const box = el.getBoundingClientRect()
    return [...el.querySelectorAll(':scope > span:not(.weather-film), :scope > strong')].map(
      (child) => {
        const text = child.getBoundingClientRect()
        return { top: text.top - box.top, bottom: text.bottom - box.bottom }
      },
    )
  })
  for (const bound of bounds) {
    expect.soft(bound.top, 'weather text overflows above bubble').toBeGreaterThanOrEqual(-1)
    expect.soft(bound.bottom, 'weather text overflows below bubble').toBeLessThanOrEqual(1)
  }
}

test('long names, nine items, suggestions and long notes remain accessible', async ({
  page,
}, info) => {
  const rev = revision(9)
  rev.unmet_requirements = Array.from(
    { length: 12 },
    (_, i) => `提醒${i + 1}：${'待人工核对。'.repeat(12)}`,
  )
  rev.items.push({
    item_id: id(60),
    source: 'suggestion',
    slot: 'bag',
    garment_id: null,
    display_asset_id: null,
    image_url: null,
    attributes: {},
    description: '未拥有建议：轻便包袋',
  })
  const audit = await mockAudit(page, rev)
  await page.goto('/')
  await expect(page.locator('.lookbook-piece')).toHaveCount(9)
  await expect(page.locator('.lookbook-suggestions')).toContainText('未拥有建议')
  await expect(page.locator('.lookbook-warning')).toContainText('不可用')
  await page.locator('.piece-photo').first().click()
  await expect(page.getByRole('dialog').getByRole('button', { name: '只换这件' })).toBeDisabled()
  await noOverflow(page)
  await page.screenshot({ path: info.outputPath('long-piece.png') })
  await page.getByRole('button', { name: '关闭面板' }).click()
  await page.goto('/collections?view=history')
  await expect(page.locator('.record-card .record-composition > div')).toHaveCount(9)
  await noOverflow(page)
  await page.screenshot({ path: info.outputPath('nine-item-card.png') })
  await page.locator('.record-card-link').click()
  await expect(page.locator('.snapshot-piece')).toHaveCount(9)
  await page.locator('.snapshot-piece').first().click()
  await expect(page.getByRole('dialog')).toContainText(longNotes)
  await noOverflow(page)
  await page.screenshot({ path: info.outputPath('long-snapshot.png') })
  expect(audit.writes).toEqual([])
  expect(audit.errors).toEqual([])
})

test('null and HTTP 404 pictures have an explicit fallback in today and records', async ({
  page,
}, info) => {
  const rev = revision()
  rev.items[0].image_url = null
  rev.items[1].image_url = '/audit-assets/missing.png'
  const audit = await mockAudit(page, rev)
  await page.goto('/')
  await expect(page.locator('.lookbook-piece').first()).toContainText('图片暂不可用')
  await expect(page.locator('.lookbook-piece').nth(1).locator('img')).toBeVisible()
  await expect
    .poll(() =>
      page
        .locator('.lookbook-piece')
        .nth(1)
        .locator('img')
        .evaluate((img: HTMLImageElement) => img.complete),
    )
    .toBe(true)
  await expect
    .soft(
      page.locator('.lookbook-piece').nth(1),
      'HTTP 404 image must show fallback, not a broken image',
    )
    .toContainText(/图片.*不可用/)
  await page.screenshot({ path: info.outputPath('today-missing.png') })
  await page.goto('/collections?view=history')
  await expect(page.locator('.record-image-empty')).toHaveCount(2)
  await page.locator('.record-card-link').click()
  await expect(page.locator('.record-image-empty')).toHaveCount(2)
  await noOverflow(page)
  await page.screenshot({ path: info.outputPath('records-missing.png') })
  expect(audit.writes).toEqual([])
  expect(audit.errors).toEqual([])
})

test('single dress and unknown weather stay inside the viewport', async ({ page }, info) => {
  const rev = revision(1)
  rev.items[0].slot = 'dress'
  const audit = await mockAudit(page, rev)
  await page.goto('/')
  await expect(page.locator('.stage-weather')).toContainText('温度未知')
  await expect(page.locator('.stage-weather')).toContainText('天气未知')
  await weatherFits(page)
  await expect(page.locator('.piece-photo')).toHaveCount(1)
  await noOverflow(page)
  await page.screenshot({ path: info.outputPath('single-unknown.png') })
  await page.getByRole('button', { name: '调整这套', exact: true }).click()
  await noOverflow(page)
  await page.goBack()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(audit.writes).toEqual([])
  expect(audit.errors).toEqual([])
})

test('long weather text remains circular and does not touch garments', async ({ page }, info) => {
  const rev = revision()
  rev.weather_snapshot = {
    source: 'manual',
    temperature_c: -90,
    condition: '强对流天气伴随短时大风及雷阵雨局部地区有大到暴雨',
  }
  const audit = await mockAudit(page, rev)
  await page.goto('/')
  const bubble = page.locator('.stage-weather')
  await expect(bubble).toContainText('-90℃')
  await weatherFits(page)
  const box = (await bubble.boundingBox())!
  expect
    .soft(Math.abs(box.height - box.width), 'long weather should not stretch the soap bubble')
    .toBeLessThan(2)
  const photo = (await page.locator('.piece-photo').first().boundingBox())!
  expect.soft(box.x + box.width).toBeLessThanOrEqual(photo.x)
  await noOverflow(page)
  await page.screenshot({ path: info.outputPath('long-weather.png') })
  expect(audit.writes).toEqual([])
  expect(audit.errors).toEqual([])
})

test('empty history favorites calendar and no-session have recovery paths', async ({
  page,
}, info) => {
  const audit = await mockAudit(page, revision(0), true)
  await page.goto('/')
  await expect(page.getByRole('link', { name: '准备搭配' })).toBeVisible()
  for (const view of ['history', 'favorites', 'calendar']) {
    await page.goto(`/collections?view=${view}&month=2026-10&date=2026-10-28`)
    await expect(page.locator('.record-card')).toHaveCount(0)
    await expect(page.locator('.record-empty')).toBeVisible()
    await noOverflow(page)
    await page.screenshot({ path: info.outputPath(`empty-${view}.png`) })
  }
  expect(audit.writes).toEqual([])
  expect(audit.errors).toEqual([])
})

test('favorites and calendar preserve long names and notes through details', async ({
  page,
}, info) => {
  const audit = await mockAudit(page, revision())
  await page.goto('/collections?view=favorites')
  await expect(page.locator('.record-card-link h3')).toHaveText(longName)
  await noOverflow(page)
  await page.screenshot({ path: info.outputPath('long-favorite.png') })
  await page.goto('/collections?view=calendar&month=2026-10&date=2026-10-28')
  await expect(page.locator('.record-notes')).toHaveText(longNotes)
  await page.getByRole('button', { name: '编辑记录' }).click()
  await expect(page.getByRole('dialog').locator('textarea')).toHaveValue(longNotes)
  await noOverflow(page)
  await page.screenshot({ path: info.outputPath('long-wear.png') })
  expect(audit.writes).toEqual([])
  expect(audit.errors).toEqual([])
})

test('unbroken 100-character garment name does not hide dialog controls', async ({
  page,
}, info) => {
  const rev = revision(1)
  rev.items[0].attributes.name = 'A'.repeat(100)
  const audit = await mockAudit(page, rev)
  await page.goto('/')
  await page.locator('.piece-photo').click()
  await noOverflow(page)
  await page.screenshot({ path: info.outputPath('unbroken-title.png'), animations: 'disabled' })
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(audit.writes).toEqual([])
  expect(audit.errors).toEqual([])
})
