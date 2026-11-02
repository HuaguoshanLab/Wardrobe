import { expect, test } from '@playwright/test'
import { id, mockAudit, revision } from './content-audit-fixtures'
import { careGarment } from './care-fixtures'
import type { CareBatch } from '../src/features/wardrobe/care/api'

async function fixture(page: import('@playwright/test').Page) {
  const audit = await mockAudit(page, revision())
  let empty = false
  const get = (n: number) => ({
    ...careGarment(n),
    version: 2,
    lifecycle: { ...careGarment(n).lifecycle, unavailable_reason: n === 2 ? 'repair' : 'washing' },
  })
  await page.route('**/api/v1/wardrobe/care?*', (route) =>
    route.fulfill({
      json: {
        data: { items: empty ? [] : [get(1), get(2)], next_cursor: null },
        request_id: id(99),
      },
    }),
  )
  await page.route('**/api/v1/garments/*', (route) =>
    route.fulfill({
      json: {
        data: get(Number(new URL(route.request().url()).pathname.split('/').at(-1)!.slice(-12))),
        request_id: id(99),
      },
    }),
  )
  return {
    audit,
    get,
    makeEmpty: () => {
      empty = true
    },
  }
}

test('care partial result focuses feedback, folds successes and restores only failures for review', async ({
  page,
}, info) => {
  const { audit, get } = await fixture(page)
  const writes: CareBatch[] = []
  await page.route('**/api/v1/wardrobe/care/actions', async (route) => {
    const body = route.request().postDataJSON() as CareBatch
    writes.push(body)
    await route.fulfill({
      json: {
        data: {
          items: body.items.map((item, n) => ({
            ...item,
            success: n === 0,
            changed: n === 0,
            code: n === 0 ? 'UPDATED' : 'STATE_CONFLICT',
            message: n === 0 ? '已完成' : '当前维修中，请逐件核对',
            garment: n === 0 ? get(1) : null,
          })),
        },
        request_id: id(99),
      },
    })
  })
  await page.goto('/wardrobe/care')
  await page.getByRole('checkbox', { name: '选择：浅蓝色棉质衬衫', exact: true }).check()
  await page.getByRole('checkbox', { name: '选择：待洗单品 2', exact: true }).check()
  await page.getByRole('button', { name: '核对并继续' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText(/其中 1 件当前无法执行/)).toBeVisible()
  await expect(dialog.getByText('当前不是待洗状态，不会恢复可穿。')).toBeVisible()
  expect(writes).toHaveLength(0)
  await page.getByRole('button', { name: '确认对 2 件执行' }).click()
  const result = page.getByRole('region', { name: '批量操作结果' })
  await expect(result.getByText('成功 1 件，未成功 1 件')).toBeVisible()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.care-feedback')).toBeFocused()
  await expect(result.getByText('待洗单品 2', { exact: true })).toBeVisible()
  await expect(result.getByText('浅蓝色棉质衬衫', { exact: true })).toBeHidden()
  await result.locator('summary').click()
  await expect(result.getByText('浅蓝色棉质衬衫', { exact: true })).toBeVisible()
  await page.screenshot({ path: info.outputPath('care-results.png') })
  await page.getByRole('combobox', { name: '批量操作', exact: true }).selectOption('location_clear')
  await page.getByRole('button', { name: '只选未成功项，重新核对' }).click()
  await expect(page.getByRole('combobox', { name: '批量操作', exact: true })).toHaveValue(
    'wash_done',
  )
  await expect(page.getByRole('combobox', { name: '批量操作', exact: true })).toBeFocused()
  await expect(page.getByRole('button', { name: '只看已选（1）' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(
    page.getByRole('checkbox', { name: '选择：浅蓝色棉质衬衫', exact: true }),
  ).toHaveCount(0)
  expect(writes).toHaveLength(1)
  expect(audit.writes).toEqual([])
  expect(audit.errors).toEqual([])
})

test('care location preview and empty-state actions preserve selection and require explicit writes', async ({
  page,
}, info) => {
  const { audit, makeEmpty } = await fixture(page)
  await page.goto('/wardrobe/care')
  await page.getByRole('checkbox', { name: '选择：浅蓝色棉质衬衫', exact: true }).check()
  await page.getByRole('button', { name: '更改操作' }).click()
  await page.getByRole('combobox', { name: '批量操作', exact: true }).selectOption('location_set')
  await page.getByLabel('新收纳位置').fill('衣柜位置'.repeat(30))
  await page.getByRole('button', { name: '核对并继续' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText(`新位置：${'衣柜位置'.repeat(30)}`, { exact: true })).toBeVisible()
  await page.screenshot({
    path: info.outputPath('care-location-preview.png'),
    animations: 'disabled',
  })
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: '核对并继续' })).toBeFocused()
  await page.reload()
  await expect(page.getByLabel('新收纳位置')).toHaveValue('衣柜位置'.repeat(30))
  await expect(page.getByRole('button', { name: '只看已选（1）' })).toBeVisible()
  makeEmpty()
  await page.getByLabel('搜索单品').fill('无匹配')
  await expect(page.getByText(/另有 1 件已选单品/)).toBeVisible()
  await page.getByRole('button', { name: '清除筛选' }).click()
  await expect(page.getByLabel('搜索单品')).toHaveValue('')
  await page.getByRole('button', { name: '清空选择' }).click()
  await page.getByRole('button', { name: '选择可穿单品', exact: true }).click()
  await expect(page.getByRole('combobox', { name: '批量操作', exact: true })).toHaveValue(
    'mark_washing',
  )
  expect(audit.writes).toEqual([])
  expect(audit.errors).toEqual([])
})
