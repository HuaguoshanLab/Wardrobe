import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = new URL('../../', import.meta.url)
test.beforeAll(() => {
  execFileSync(fileURLToPath(new URL('backend/.venv/bin/python', root)), [
    fileURLToPath(new URL('./import-audit-fixtures.py', import.meta.url)),
  ])
})
async function upload(page: Page, kind: 'photos' | 'excel', path: string) {
  await page.goto('/imports')
  if (kind === 'excel') await page.getByRole('button', { name: /导入 Excel/ }).click()
  await page.getByLabel(kind === 'photos' ? '上传照片' : '上传 Excel').setInputFiles(path)
  await page
    .getByRole('button', { name: kind === 'photos' ? '上传并识别照片' : '上传并检查 Excel' })
    .click()
  await expect(page).toHaveURL(/\/imports\/[\w-]+$/)
  const id = page.url().split('/').pop()!
  await expect
    .poll(
      async () => (await (await page.request.get(`/api/v1/imports/${id}`)).json()).data.job_status,
      { timeout: 120000 },
    )
    .toBe('succeeded')
  await page.reload()
  return id
}
const fixture = (name: string) =>
  fileURLToPath(new URL(`data/acceptance/import-audit/fixtures/${name}.xlsx`, root))

test('照片上传、改品类清子类、入库响应丢失后同键恢复', async ({ page }, info) => {
  if (info.project.name === 'mobile-chromium')
    await page.setViewportSize({ width: 320, height: 568 })
  const id = await upload(
    page,
    'photos',
    fileURLToPath(new URL('./fixtures/shirt.png', import.meta.url)),
  )
  await expect(page.getByText(/子类：.+/)).toBeVisible()
  await page.getByRole('button', { name: '修改属性', exact: true }).click()
  await page.getByLabel('品类', { exact: true }).selectOption('shoes')
  await expect(page.getByLabel('子类', { exact: true })).toHaveValue('')
  await expect(page.getByText(/原子类已清空/)).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('category-subtype-review.png'), fullPage: true })
  await page.getByLabel('子类', { exact: true }).fill('休闲鞋')
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await page.getByRole('button', { name: '核对入库', exact: true }).click()
  await expect(page.getByRole('dialog').getByText('子类：休闲鞋')).toBeVisible()
  const keys: string[] = []
  await page.route(`**/api/v1/imports/${id}/confirm`, async (route) => {
    keys.push(route.request().headers()['idempotency-key'])
    const response = await route.fetch()
    if (keys.length === 1) await route.abort('failed')
    else await route.fulfill({ response })
  })
  await page.getByRole('button', { name: '确认入库', exact: true }).click()
  await expect(page.getByRole('button', { name: '重试上次确认' })).toBeEnabled()
  await page.reload()
  await page.getByRole('button', { name: '重试上次确认' }).click()
  await expect(page.getByRole('button', { name: '重试上次确认' })).toHaveCount(0)
  await expect(page.getByText('本批已处理完毕')).toBeVisible()
  expect(keys).toHaveLength(2)
  expect(keys[0]).toBe(keys[1])
  const row = (await (await page.request.get(`/api/v1/imports/${id}`)).json()).data.rows[0]
  const garment = (
    await (await page.request.get(`/api/v1/garments/${row.confirmed_garment_id}`)).json()
  ).data
  expect(garment.category).toBe('shoes')
  expect(garment.subtype_id).toBeTruthy()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('photo-complete.png'), fullPage: true })
})

test('Excel 金额规范化、非法字段直接重置后确认入库', async ({ page }, info) => {
  if (info.project.name === 'mobile-chromium')
    await page.setViewportSize({ width: 320, height: 568 })
  let recognitionRequests = 0
  page.on('request', (r) => {
    if (r.method() === 'POST' && /photos|retry/.test(r.url())) recognitionRequests++
  })
  const validId = await upload(page, 'excel', fixture('valid'))
  await page.getByRole('button', { name: '修改属性', exact: true }).click()
  await expect(page.getByLabel('购入金额（元）')).toHaveValue('19.90')
  await page.getByRole('button', { name: '取消编辑', exact: true }).click()
  await page.getByRole('button', { name: '核对入库', exact: true }).click()
  await page.getByRole('button', { name: '确认入库', exact: true }).click()
  await expect(page.getByText('本批已处理完毕')).toBeVisible()
  const valid = (await (await page.request.get(`/api/v1/imports/${validId}`)).json()).data.rows[0]
  expect(valid.analysis_status).toBe('not_requested')
  const invalidId = await upload(page, 'excel', fixture('invalid'))
  await expect(page.getByRole('button', { name: '核对入库', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '修改属性', exact: true }).click()
  await expect(page.getByRole('button', { name: '重置购入金额（元）' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('excel-field-recovery.png'), fullPage: true })
  await page.getByRole('button', { name: '重置购入金额（元）' }).click()
  await page.getByRole('button', { name: '重置合身情况' }).click()
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await page.getByRole('button', { name: '核对入库', exact: true }).click()
  await page.getByRole('button', { name: '确认入库', exact: true }).click()
  await expect(page.getByText('本批已处理完毕')).toBeVisible()
  const row = (await (await page.request.get(`/api/v1/imports/${invalidId}`)).json()).data.rows[0]
  const garment = (
    await (await page.request.get(`/api/v1/garments/${row.confirmed_garment_id}`)).json()
  ).data
  expect(garment.lifecycle.price).toBeNull()
  expect(garment.lifecycle.fit).toBe('unknown')
  expect(recognitionRequests).toBe(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('excel-complete.png'), fullPage: true })
})

test('Excel 结构错误提示修正源文件且不能入库', async ({ page }) => {
  await upload(page, 'excel', fixture('formula'))
  await expect(page.getByText('需要修正源文件后重新上传')).toBeVisible()
  await expect(page.getByRole('button', { name: '核对入库', exact: true })).toBeDisabled()
  await page.getByText('更多操作', { exact: true }).click()
  await expect(page.getByRole('link', { name: '修正文件后重新上传' })).toBeVisible()
})
