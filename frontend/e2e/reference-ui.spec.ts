import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

for (const [width, height] of [
  [320, 568],
  [375, 667],
  [844, 390],
  [1280, 900],
]) {
  test(`reference UI ${width}x${height}: edit, protect draft, errors and zero automatic writes`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height })
    const id = '00000000-0000-4000-8000-000000000001'
    let writes = 0
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    const ref = {
      id,
      version: 3,
      image_url: '/reference-fixture.png',
      analysis: {
        subject: 'multiple',
        clues: [],
        warnings: ['主体不明确，未选取任何人的衣服。请裁剪图片或手工添加线索。'],
      },
      clues: [],
      confirmed: false,
      current_job_id: null,
      revision_ids: [],
      provider_mode: 'qwen',
      created_at: '2026-11-12T00:00:00Z',
    }
    const photo = await readFile(new URL('./fixtures/shirt.png', import.meta.url))
    await page.route('**/reference-fixture.png', (r) =>
      r.fulfill({ body: photo, contentType: 'image/png' }),
    )
    await page.route('**/api/v1/**', async (route) => {
      if (route.request().method() !== 'GET') {
        writes++
        return route.abort()
      }
      const path = new URL(route.request().url()).pathname
      if (path === `/api/v1/references/${id}`)
        return route.fulfill({ json: { data: ref, request_id: id } })
      if (path === '/api/v1/references')
        return route.fulfill({ json: { data: [ref], request_id: id } })
      return route.continue()
    })
    await page.goto(`/collections/reference/${id}`)
    await expect(page.getByRole('heading', { name: '核对参考线索' })).toBeVisible()
    await page.getByRole('button', { name: '添加参考单品' }).click()
    await page.getByRole('button', { name: '黑色', exact: true }).click()
    await expect(page.getByRole('button', { name: '黑色', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    const chip = await page.getByRole('button', { name: '黑色', exact: true }).boundingBox()
    expect(chip!.height).toBeGreaterThanOrEqual(44)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy()
    await page.screenshot({ path: info.outputPath('reference-editor.png'), fullPage: true })
    await page.getByRole('link', { name: '← 全部参考图' }).click()
    await expect(page.getByRole('dialog', { name: '离开参考线索编辑？' })).toBeVisible()
    await page.getByRole('button', { name: '保留草稿并离开' }).click()
    await expect(page).toHaveURL(/\/collections\/reference$/)
    await page.screenshot({ path: info.outputPath('reference-list.png'), fullPage: true })
    expect(writes).toBe(0)
    expect(errors).toEqual([])
  })
}
