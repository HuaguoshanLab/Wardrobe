import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

for (const source of ['photos', 'excel'] as const) {
  test(`${source}: preview, edit, confirm, refresh, filter and delete`, async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(90000)
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    let uploads = 0
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().endsWith(`/imports/${source}`)) uploads++
    })
    await page.goto('/imports')
    if (source === 'excel') {
      await page.getByRole('button', { name: '导入 Excel', exact: false }).click()
      const template = await request.get('/api/v1/imports/template')
      await page.getByLabel('上传 Excel').setInputFiles({
        name: 'e2e.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        buffer: await template.body(),
      })
    } else {
      await page.getByLabel('上传照片').setInputFiles({
        name: 'e2e.png',
        mimeType: 'image/png',
        buffer: await readFile(new URL('./fixtures/shirt.png', import.meta.url)),
      })
    }
    await page.getByRole('button', { name: '上传并开始预览' }).click()
    await expect(page.getByRole('heading', { name: '逐行审核' })).toBeVisible()
    await expect(page.locator('.page-heading')).toContainText('已完成', { timeout: 60000 })
    await expect(page.getByRole('button', { name: '确认入库', exact: true })).toBeEnabled()
    await page.reload()
    await expect(page.getByRole('heading', { name: '逐行审核' })).toBeVisible()
    expect(uploads).toBe(1)
    await page.getByRole('button', { name: '修改属性' }).click()
    const name = `E2E-${source}-${testInfo.project.name}-${Date.now()}`
    await page.getByLabel('名称', { exact: true }).fill(name)
    await page.getByLabel('品类', { exact: true }).selectOption('shoes')
    await page.getByRole('button', { name: '保存修改' }).click()
    await expect(page.getByRole('button', { name: '关闭编辑' })).toHaveCount(0)
    await page.screenshot({
      path: `/private/tmp/wardrobe-p2-${source}-${testInfo.project.name}-review.png`,
      fullPage: true,
    })
    await page.getByRole('button', { name: '确认入库', exact: true }).click()
    await expect(page.getByRole('link', { name: '查看单品', exact: true })).toBeVisible()
    await page.getByRole('link', { name: '查看单品', exact: true }).click()
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
    const garmentId = page.url().split('/').at(-1)!
    try {
      await page.getByLabel('状态', { exact: true }).selectOption('unavailable')
      await page.getByLabel('展示图片').selectOption('original')
      await page.getByRole('button', { name: '保存修改' }).click()
      await expect(page.getByRole('status')).toHaveText('已保存')
      await page.goto('/wardrobe')
      await page.getByLabel('搜索衣服').fill(name)
      await page.getByLabel('筛选状态').selectOption('unavailable')
      await expect(page.locator('.garment-card')).toHaveCount(1)
      await page.screenshot({
        path: `/private/tmp/wardrobe-p2-${source}-${testInfo.project.name}-wardrobe.png`,
        fullPage: true,
      })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
      await page.locator('.garment-card').click()
      page.once('dialog', (d) => d.accept())
      await page.getByRole('button', { name: '删除单品' }).click()
      await expect(page).toHaveURL(/\/wardrobe$/)
      expect(errors).toEqual([])
    } finally {
      const response = await request.get(`/api/v1/garments/${garmentId}`)
      if (response.ok()) {
        const { data } = await response.json()
        await request.delete(`/api/v1/garments/${garmentId}`, {
          headers: { 'If-Match': String(data.version) },
        })
      }
    }
  })
}
