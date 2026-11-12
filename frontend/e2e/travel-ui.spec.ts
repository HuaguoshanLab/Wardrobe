import { test, expect } from '@playwright/test'
import { travelFixture } from './travel-fixture'
for (const [width, height] of [
  [320, 568],
  [375, 667],
  [844, 390],
  [1280, 900],
]) {
  test(`travel readable preview and draft at ${width}x${height}`, async ({
    page,
    request,
  }, info) => {
    await page.setViewportSize({ width, height })
    if (width === 844) await page.emulateMedia({ reducedMotion: 'reduce' })
    const { id, draft, garments, errors, writes } = await travelFixture(page, request)
    await page.goto(`/collections/travel/${id}`)
    await expect(page.getByRole('heading', { name: draft.name, exact: true })).toBeVisible()
    await expect(page.locator('.travel-outfit')).toHaveCount(3)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy()
    await page.screenshot({ path: info.outputPath('travel-plan.png'), fullPage: true })
    await expect(page.getByRole('region', { name: '已保存行程条件' })).toContainText('期望 8 件')
    await page.getByRole('button', { name: /行李清单 ·/ }).click()
    await expect(page.locator('#travel-packing')).toBeFocused()
    await page.getByRole('button', { name: '只看待收拾' }).click()
    await expect(page.getByRole('button', { name: '只看待收拾' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await page.getByRole('button', { name: '历史版本', exact: true }).click()
    await page.getByRole('button', { name: '查看第 0 版', exact: true }).click()
    await expect(page.locator('.travel-packing')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '调整这一天', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: '回到当前版本' }).click()
    const adjust = page.getByRole('button', { name: '调整这一天', exact: true }).first()
    await adjust.click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByLabel('这一天的调整要求').fill('明天需要更正式')
    await page.goBack()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(adjust).toBeFocused()
    await adjust.click()
    await expect(page.getByLabel('这一天的调整要求')).toHaveValue('明天需要更正式')
    await page.getByRole('button', { name: '暂不操作', exact: true }).click()
    await expect(adjust).toBeFocused()
    const remove = page.getByRole('button', { name: '删除计划', exact: true })
    await remove.click()
    await page.getByRole('button', { name: '保留计划', exact: true }).click()
    await expect(remove).toBeFocused()
    await page.getByRole('button', { name: '编辑行程', exact: true }).click()
    await page.getByLabel('行程名称').fill('未提交草稿')
    await page.getByLabel('手动填写这一天的天气').first().check()
    const reset = page.getByRole('button', { name: '重置草稿', exact: true })
    await reset.click()
    await expect(page.getByRole('dialog', { name: '重置行程草稿？' })).toBeVisible()
    await page.getByRole('button', { name: '继续编辑', exact: true }).click()
    await expect(reset).toBeFocused()
    await expect(page.getByLabel('行程名称')).toHaveValue('未提交草稿')
    await page.screenshot({ path: info.outputPath('travel-editor.png'), fullPage: true })
    await page.reload()
    await page.getByRole('button', { name: '编辑行程', exact: true }).click()
    await expect(page.getByLabel('行程名称')).toHaveValue('未提交草稿')
    await expect(page.getByLabel('手动填写这一天的天气').first()).toBeChecked()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy()
    await page.getByText('必带单品 · 已选 0/20 件', { exact: true }).click()
    await page.locator('.travel-pick input').first().check()
    await expect(page.locator('.travel-selected strong')).not.toHaveText('正在读取单品…')
    await expect(page.locator('.travel-selected')).not.toContainText(garments[0].id.slice(0, 8))
    await page.locator('.travel-selected button').filter({ hasText: '移除' }).click()
    await reset.click()
    await page.getByRole('button', { name: '确认重置草稿' }).click()
    await expect(page.getByLabel('行程名称')).toHaveValue(draft.name)
    await expect(page.getByLabel('手动填写这一天的天气').first()).not.toBeChecked()
    expect(writes()).toBe(0)
    expect(errors).toEqual([])
  })
}

test('packing gives immediate feedback, keeps saved progress, and recovers a failed write', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 375, height: 667 })
  const { id, plan, errors } = await travelFixture(page, request)
  let release: () => void = () => {}
  let attempts = 0
  await page.route(`**/api/v1/travel-plans/${id}/packing`, async (route) => {
    attempts++
    if (attempts === 1) {
      await new Promise<void>((resolve) => {
        release = resolve
      })
      const body = route.request().postDataJSON()
      plan.packing.forEach((entry) => {
        if (entry.garment_id === body.garment_id) entry.packed = body.packed
      })
      plan.version++
      return route.fulfill({ json: { data: plan, request_id: id } })
    }
    return route.fulfill({
      status: 503,
      json: {
        error: { code: 'UNAVAILABLE', message: '保存暂不可用', details: {} },
        request_id: id,
      },
    })
  })
  await page.goto(`/collections/travel/${id}`)
  const row = page.locator('.travel-pack-row').first()
  await row.getByRole('checkbox').check()
  await expect(row).toContainText('正在保存…')
  await expect(row.getByRole('checkbox')).toBeChecked()
  await expect(page.getByRole('progressbar')).toHaveAttribute('value', '0')
  release()
  await expect(page.getByRole('progressbar')).toHaveAttribute('value', '1')
  await expect(page.getByRole('button', { name: '编辑行程', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '只看待收拾' }).click()
  await expect(page.locator('.travel-pack-row')).toHaveCount(plan.packing.length - 1)
  await page.getByRole('button', { name: '只看待收拾' }).click()
  await row.getByRole('checkbox').uncheck()
  await expect(page.getByRole('button', { name: '重发原操作' })).toBeVisible()
  await expect(row.getByRole('checkbox')).toBeChecked()
  await expect(page.getByRole('progressbar')).toHaveAttribute('value', '1')
  expect(attempts).toBe(2)
  expect(errors).toEqual([])
})

test('failed adjustment remains closable and keeps its text for explicit recovery', async ({
  page,
  request,
}) => {
  const { id, errors } = await travelFixture(page, request)
  let calls = 0
  await page.route(`**/api/v1/travel-plans/${id}/generate`, async (route) => {
    calls++
    return route.fulfill({
      status: 503,
      json: { error: { code: 'UNAVAILABLE', message: '网络中断', details: {} }, request_id: id },
    })
  })
  await page.goto(`/collections/travel/${id}`)
  const trigger = page.getByRole('button', { name: '调整这一天', exact: true }).first()
  await trigger.click()
  await page.getByLabel('这一天的调整要求').fill('保留外套，换成更正式的鞋')
  await page.getByRole('button', { name: '确认调整这一天' }).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('提交未完成')
  await page.getByRole('button', { name: '暂不操作', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: '读取状态并结束恢复' }).click()
  await trigger.click()
  await expect(page.getByLabel('这一天的调整要求')).toHaveValue('保留外套，换成更正式的鞋')
  await page.getByRole('button', { name: '暂不操作', exact: true }).click()
  expect(calls).toBe(1)
  expect(errors).toEqual([])
})

test('seven-day editor keeps focused fields above the save bar and search Enter never saves', async ({
  page,
  request,
}, info) => {
  await page.setViewportSize({ width: 375, height: 667 })
  const { id, writes, errors } = await travelFixture(page, request)
  await page.goto(`/collections/travel/${id}`)
  await page.getByRole('button', { name: '编辑行程', exact: true }).click()
  await page.getByLabel('行程天数').selectOption('7')
  await expect(page.locator('.travel-day-input')).toHaveCount(7)
  await page.getByLabel('行程名称').fill('城市慢旅行'.repeat(12))
  await page.getByLabel('补充要求').fill('需要适合步行的鞋子。'.repeat(40))
  await page.getByLabel('补充要求').press('Tab')
  await page.getByLabel('补充要求').focus()
  const field = await page.getByLabel('补充要求').boundingBox()
  const footer = await page.locator('.travel-editor-footer').boundingBox()
  expect(field!.y).toBeGreaterThanOrEqual(0)
  expect(field!.y + field!.height).toBeLessThanOrEqual(footer!.y)
  await page.screenshot({ path: info.outputPath('seven-day-editor-viewport.png') })
  await page.getByText('必带单品 · 已选 0/20 件', { exact: true }).click()
  await page.getByLabel('查找必带衣服').fill('不存在的旅行单品')
  await page.getByLabel('查找必带衣服').press('Enter')
  await expect(page.getByText('没有找到可用单品。')).toBeVisible()
  await expect(page.getByLabel('行程名称')).toHaveValue('城市慢旅行'.repeat(12))
  expect(writes()).toBe(0)
  expect(errors).toEqual([])
})
