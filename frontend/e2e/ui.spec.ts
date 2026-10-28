import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  // These UX checks are safe on the user's running app: block every API write.
  await page.route('**/api/v1/**', (route) =>
    route.request().method() === 'GET' ? route.continue() : route.abort('blockedbyclient'),
  )
})

test('conditions disclose without generation and nested routes keep navigation active', async ({
  page,
}) => {
  const writes: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/api/v1/') && request.method() !== 'GET') writes.push(request.url())
  })
  await page.goto('/')
  await expect(page.getByLabel('场合', { exact: true })).toHaveCount(0)
  await page.getByRole('link', { name: /^(重新搭配|准备搭配)$/ }).click()
  await expect(page.getByRole('heading', { name: '今天想怎么穿？' })).toBeVisible()
  await expect(page.getByLabel('风格来源')).not.toBeVisible()
  await page.getByText(/^更多条件/).click()
  await page.getByLabel('风格来源').selectOption('override')
  await page.getByText(/^天气与城市/).click()
  await page.getByLabel('天气来源').selectOption('manual')
  await page.getByLabel('手动温度（℃）').fill('0')
  await page.getByLabel('天气现象').fill('雪')
  await page.getByText(/^更多条件/).click()
  await page.getByText(/^更多条件/).click()
  await expect(page.getByLabel('手动温度（℃）')).toHaveValue('0')
  await page.getByLabel('手动温度（℃）').fill('')
  await page.getByText(/^更多条件/).click()
  await page.getByRole('button', { name: '核对条件' }).click()
  await expect(page.getByRole('alert')).toContainText('请输入 -90 至 60℃')
  await expect(page.getByLabel('手动温度（℃）')).toBeFocused()
  await page.reload()
  await expect(page.getByRole('button', { name: '生成搭配', exact: true })).toBeVisible()
  await page.goto('/imports')
  await expect(page.getByRole('navigation').getByRole('link', { name: '我的衣橱' })).toHaveClass(
    'active',
  )
  await page.getByRole('button', { name: /导入 Excel/ }).click()
  await expect(page.getByLabel('上传 Excel')).toBeVisible()
  expect(writes).toEqual([])
})

test('wardrobe filters survive details and empty search has a recovery action', async ({
  page,
}, testInfo) => {
  await page.goto('/wardrobe?availability=available')
  await page.getByRole('button', { name: /^筛选/ }).click()
  await expect(page.getByRole('button', { name: '可穿', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.getByRole('button', { name: '查看结果', exact: true }).click()
  await expect(page.locator('.garment-card').first()).toBeVisible()
  await page.locator('.garment-card').first().click()
  await expect(page.locator('.detail-image')).toBeVisible()
  await expect
    .poll(() =>
      page
        .locator('img.detail-image')
        .evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0),
    )
    .toBe(true)
  await page.screenshot({
    path: testInfo.outputPath('wardrobe-detail.png'),
    animations: 'disabled',
  })
  await expect(page.getByRole('navigation').getByRole('link', { name: '我的衣橱' })).toHaveClass(
    'active',
  )
  await page.getByRole('link', { name: '返回衣橱' }).click()
  await page.getByRole('button', { name: /^筛选/ }).click()
  await expect(page.getByRole('button', { name: '可穿', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.getByRole('button', { name: '查看结果', exact: true }).click()
  await page.getByLabel('搜索衣服').fill('__ui_no_match_7f3b__')
  await expect(page.getByRole('heading', { name: '没有找到匹配的单品' })).toBeVisible()
  await page.getByRole('button', { name: '查看全部衣服' }).click()
  await expect(page.getByLabel('搜索衣服')).toHaveValue('')
  await page.getByRole('button', { name: /^筛选/ }).click()
  await expect(page.getByRole('button', { name: '全部状态', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.getByRole('button', { name: '查看结果', exact: true }).click()
  await expect(page.locator('.garment-card').first()).toBeVisible()
})

test('responsive pages, keyboard disclosure and reduced motion remain usable', async ({
  page,
}, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.emulateMedia({ reducedMotion: 'reduce' })
  for (const width of [375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    for (const path of [
      '/',
      '/wardrobe',
      '/collections?view=history',
      '/imports',
      '/calendar',
      '/settings',
      '/outfits/prepare',
    ]) {
      await page.goto(path)
      await expect(page.locator('main h1')).toBeVisible()
      await expect(page.locator('main')).not.toHaveText(/页面暂时无法显示/)
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true)
      if (path === '/collections?view=history') {
        await expect(page.locator('.record-grid').first()).toHaveCSS('display', 'grid')
      }
      if (path === '/') await expect(page.locator('.lookbook, .lookbook-empty')).toBeVisible()
      if (path === '/outfits/prepare')
        await expect(page.getByLabel('日常', { exact: true })).toBeVisible()
      if (path === '/wardrobe') await expect(page.locator('.garment-card').first()).toBeVisible()
      if (path === '/') {
        await expect
          .poll(() =>
            page
              .locator('.piece-photo img')
              .evaluateAll((images) =>
                images.every(
                  (img) =>
                    (img as HTMLImageElement).complete &&
                    (img as HTMLImageElement).naturalWidth > 0,
                ),
              ),
          )
          .toBe(true)
      }
      if (path === '/' || path === '/wardrobe') {
        await page.screenshot({
          path: testInfo.outputPath(`${width}-${path === '/' ? 'home' : 'wardrobe'}.png`),
        })
      }
    }
  }
  await page.goto('/outfits/prepare')
  const disclosure = page.getByText(/^更多条件/)
  await disclosure.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByLabel('风格来源')).toBeVisible()
  await page.setViewportSize({ width: 844, height: 390 })
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true)
  expect(errors).toEqual([])
})

test('H5 puts outfit images in the first screen and browsing is read-only', async ({ page }) => {
  const writes: string[] = []
  page.on('request', (r) => {
    if (r.url().includes('/api/v1/') && r.method() !== 'GET') writes.push(r.url())
  })
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/')
  await expect(page.locator('.lookbook')).toBeVisible()
  const photo = page.locator('.piece-photo img').first()
  await expect(photo).toBeInViewport()
  await expect.poll(async () => (await photo.boundingBox())?.y ?? Infinity).toBeLessThan(260)
  await expect(page.getByRole('button', { name: '记录穿着', exact: true })).toBeInViewport()
  await expect(page.locator('.conditions-panel')).toHaveCount(0)
  const options = page.getByRole('group', { name: '浏览搭配方案' }).getByRole('button')
  const count = await options.count()
  for (let i = 0; i < count; i++) {
    await options.nth(i).click()
    await expect(options.nth(i)).toHaveAttribute('aria-pressed', 'true')
  }
  expect(writes).toEqual([])
  await page.reload()
  await expect(page.locator('.lookbook')).toBeVisible()
  const adjust = page.getByRole('button', { name: '调整这套', exact: true })
  await adjust.click()
  await expect(page.getByRole('dialog', { name: '调整这套', exact: true })).toBeVisible()
  await expect(page).toHaveURL((url) => url.pathname === '/')
  await page.getByRole('button', { name: '描述要求', exact: true }).click()
  await expect(page.getByLabel('聊天调整要求')).toBeVisible()
  await page.reload()
  await expect(page.getByRole('dialog', { name: '调整这套', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '关闭面板' }).click()
  await expect(page.locator('.lookbook')).toBeVisible()
  expect(writes).toEqual([])
})

test('stage sheets restore focus and swipes browse without writes', async ({ page }) => {
  const writes: string[] = []
  page.on('request', (r) => {
    if (r.url().includes('/api/v1/') && r.method() !== 'GET') writes.push(r.url())
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  const notes = page.getByRole('button', { name: /搭配说明/ })
  await notes.click()
  await expect(page.getByRole('dialog', { name: '搭配说明' })).toBeVisible()
  await page.getByRole('button', { name: '关闭面板' }).click()
  await expect(notes).toBeFocused()
  const piece = page.locator('.piece-photo').first()
  await piece.click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('button', { name: '只换这件' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(piece).toBeFocused()
  const options = page.getByRole('group', { name: '浏览搭配方案' }).getByRole('button')
  await options.first().click()
  const board = page.locator('.lookbook-board')
  const swipe = async (x: number, y: number) =>
    board.evaluate(
      (element, end) => {
        const start = new Touch({ identifier: 1, target: element, clientX: 260, clientY: 300 })
        element.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [start] }))
        const finish = new Touch({ identifier: 1, target: element, clientX: end.x, clientY: end.y })
        element.dispatchEvent(
          new TouchEvent('touchend', { bubbles: true, changedTouches: [finish] }),
        )
      },
      { x, y },
    )
  await swipe(250, 450)
  await expect(options.first()).toHaveAttribute('aria-pressed', 'true')
  if ((await options.count()) > 1) {
    await swipe(80, 310)
    await expect(options.nth(1)).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('dialog')).toHaveCount(0)
  }
  expect(writes).toEqual([])
})

test('wardrobe category rail and season row stay fixed while the list scrolls', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/wardrobe')
  const categories = page.getByRole('group', { name: '品类筛选' })
  const seasons = page.getByRole('group', { name: '季节筛选' })
  const results = page.getByRole('region', { name: '衣橱列表' })
  await expect(page.locator('.garment-card').first()).toBeVisible()
  const categoryY = (await categories.boundingBox())!.y
  const seasonY = (await seasons.boundingBox())!.y
  await results.evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  expect(await results.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
  expect((await categories.boundingBox())!.y).toBe(categoryY)
  expect((await seasons.boundingBox())!.y).toBe(seasonY)
  await categories.getByRole('button', { name: '上装', exact: true }).click()
  await seasons.getByRole('button', { name: '春', exact: true }).click()
  await expect(page).toHaveURL(
    (url) =>
      url.searchParams.get('category') === 'top' &&
      url.searchParams.get('season') === 'spring' &&
      !url.searchParams.has('cursor'),
  )
  await expect(categories.getByRole('button', { name: '上装', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(seasons.getByRole('button', { name: '春', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect.poll(() => results.evaluate((element) => element.scrollTop)).toBe(0)
  await page.reload()
  await expect(categories.getByRole('button', { name: '上装', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(seasons.getByRole('button', { name: '春', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await categories.getByRole('button', { name: '其他配饰', exact: true }).scrollIntoViewIfNeeded()
  await expect(categories.getByRole('button', { name: '其他配饰', exact: true })).toBeInViewport()
})

test('settings rows open subpages with a named header and reliable back link', async ({ page }) => {
  const writes: string[] = []
  page.on('request', (r) => {
    if (r.url().includes('/api/v1/') && r.method() !== 'GET') writes.push(r.url())
  })
  await page.goto('/settings')
  await expect(page.locator('.settings-menu-row')).toHaveCount(4)
  await expect(page.getByRole('button', { name: '保存偏好', exact: true })).toHaveCount(0)
  for (const [path, title] of [
    ['preferences', '穿衣偏好'],
    ['location', '默认城市'],
    ['backups', '备份与恢复'],
    ['services', '服务状态与诊断'],
  ]) {
    await page.getByRole('link', { name: title, exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/settings/${path}$`))
    await expect(
      page.locator('.subpage-header').getByRole('heading', { name: title, exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('navigation').getByRole('link', { name: '设置', exact: true }),
    ).toHaveClass('active')
    await page.reload()
    await expect(
      page.locator('.subpage-header').getByRole('heading', { name: title, exact: true }),
    ).toBeVisible()
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true)
    await page.getByRole('link', { name: '返回设置', exact: true }).click()
    await expect(page).toHaveURL(/\/settings$/)
  }
  expect(writes).toEqual([])
})

test('conditions and imports share the secondary page header and explicit parent routes', async ({
  page,
}) => {
  const writes: string[] = []
  page.on('request', (r) => {
    if (r.url().includes('/api/v1/') && r.method() !== 'GET') writes.push(r.url())
  })
  for (const [path, title, label, parent] of [
    ['/outfits/prepare', '搭配条件', '返回穿搭', '/'],
    ['/imports', '录入衣服', '返回衣橱', '/wardrobe'],
  ]) {
    await page.goto(path)
    const header = page.locator('.subpage-header')
    await expect(header.getByRole('heading', { name: title, exact: true })).toBeVisible()
    await expect(header.getByRole('link', { name: label, exact: true })).toHaveAttribute(
      'href',
      parent,
    )
    await page.reload()
    await header.getByRole('link', { name: label, exact: true }).click()
    await expect(page).toHaveURL((url) => url.pathname === parent)
  }
  const response = await page.request.get('/api/v1/outfit-sessions/current')
  const session = (await response.json()).data
  if (session) {
    await page.goto(`/outfits/${session.id}/prepare`)
    await expect(
      page.locator('.subpage-header').getByRole('link', { name: '返回穿搭' }),
    ).toHaveAttribute('href', `/outfits/${session.id}`)
  }
  expect(writes).toEqual([])
})

test('today sheets keep their header visible and return to the same outfit without writes', async ({
  page,
}, testInfo) => {
  const writes: string[] = []
  page.on('request', (r) => {
    if (r.url().includes('/api/v1/') && r.method() !== 'GET') writes.push(r.url())
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.locator('.lookbook')).toBeVisible()
  for (const [name, title] of [
    ['收藏', '收藏这套'],
    ['记录穿着', '记录穿着'],
    ['调整这套', '调整这套'],
    ['搭配说明', '搭配说明'],
  ]) {
    await page.getByRole('button', { name, exact: true }).click()
    const dialog = page.getByRole('dialog', { name: title, exact: true })
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveCSS('opacity', '1')
    await expect
      .poll(() =>
        dialog
          .locator('img')
          .evaluateAll((images) =>
            images.every(
              (img) =>
                (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0,
            ),
          ),
      )
      .toBe(true)
    await expect(dialog.getByRole('button', { name: '关闭面板' })).toBeInViewport()
    await dialog.locator('.sheet-body').evaluate((el) => {
      el.scrollTop = el.scrollHeight
    })
    await expect(dialog.getByRole('heading', { name: title, exact: true })).toBeInViewport()
    await page.screenshot({
      path: testInfo.outputPath(`today-${name}.png`),
      animations: 'disabled',
    })
    await dialog.getByRole('button', { name: '关闭面板' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page).toHaveURL((url) => url.pathname === '/')
  }
  await page.locator('.piece-photo').first().click()
  await expect(page.getByRole('dialog').getByRole('checkbox', { name: /锁定此单品/ })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCSS('opacity', '1')
  await page.screenshot({ path: testInfo.outputPath('today-piece.png'), animations: 'disabled' })
  await page.getByRole('button', { name: '关闭面板' }).click()
  await page.getByRole('link', { name: '重新搭配' }).click()
  await expect(page.getByLabel('本次补充要求')).toBeVisible()
  await page.getByLabel('本次补充要求').fill('散步，穿得轻便一些')
  await page.reload()
  await expect(page.getByLabel('本次补充要求')).toHaveValue('散步，穿得轻便一些')
  await page.screenshot({ path: testInfo.outputPath('today-conditions.png'), fullPage: true })
  expect(writes).toEqual([])
})

test('collection and wear confirmations send only the displayed revision and return inline', async ({
  page,
}) => {
  const writes: { path: string; body: Record<string, unknown> }[] = []
  // Mock mutations in the browser; never create records in the user's database.
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    if (request.method() === 'GET') return route.continue()
    const path = new URL(request.url()).pathname
    if (['/api/v1/favorites', '/api/v1/wear-records'].includes(path)) {
      writes.push({ path, body: request.postDataJSON() })
      return route.fulfill({
        json: {
          data: { id: '00000000-0000-4000-8000-000000000001' },
          request_id: '00000000-0000-4000-8000-000000000001',
        },
      })
    }
    return route.abort('blockedbyclient')
  })
  await page.goto('/')
  await expect(page.locator('.lookbook')).toBeVisible()
  const selected = (await (await page.request.get('/api/v1/outfit-sessions/current')).json()).data
    .selected_revision_id
  await page.getByRole('button', { name: '收藏', exact: true }).click()
  await page.getByLabel('收藏名称（选填）').fill('浏览器模拟验证')
  await page.getByRole('button', { name: '确认收藏' }).click()
  await expect(page.getByText('已收藏这套搭配')).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(writes).toHaveLength(1)
  expect(writes[0]).toEqual({
    path: '/api/v1/favorites',
    body: { revision_id: selected, name: '浏览器模拟验证' },
  })
  await page.getByRole('button', { name: '记录穿着', exact: true }).click()
  await page.getByRole('button', { name: '确认记录穿着' }).click()
  await expect(page.getByText('穿着记录已保存')).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(writes).toHaveLength(2)
  expect(writes[1].body.revision_id).toBe(selected)
  await expect(page).toHaveURL((url) => url.pathname === '/')
})

test('outfit composition keeps all schemes and actions usable on narrow screens', async ({
  page,
}, testInfo) => {
  for (const width of [320, 375, 430]) {
    await page.setViewportSize({ width, height: 812 })
    await page.goto('/')
    const options = page.getByRole('group', { name: '浏览搭配方案' }).getByRole('button')
    await expect(options.first()).toBeVisible()
    for (let index = 0; index < (await options.count()); index++) {
      await options.nth(index).click()
      await expect(page.locator('.piece-photo img').first()).toBeVisible()
      await expect
        .poll(() =>
          page
            .locator('.piece-photo img')
            .evaluateAll((images) =>
              images.every(
                (image) =>
                  (image as HTMLImageElement).complete &&
                  (image as HTMLImageElement).naturalWidth > 0,
              ),
            ),
        )
        .toBe(true)
      const photos = await page.locator('.piece-photo').evaluateAll((items) =>
        items.map((item) => {
          const box = item.getBoundingClientRect()
          return { x: box.x, y: box.y, width: box.width, height: box.height }
        }),
      )
      const tools = await page.locator('.stage-tools').boundingBox()
      const weather = await page.locator('.stage-weather').boundingBox()
      expect(Math.abs(tools!.y - weather!.y)).toBeLessThan(1)
      expect(Math.abs(photos[0].y - weather!.y)).toBeLessThan(1)
      expect(photos[0].x).toBeGreaterThanOrEqual(weather!.x + weather!.width)
      for (const photo of photos) {
        expect(
          Math.abs(photo.x + photo.width / 2 - (photos[0].x + photos[0].width / 2)),
        ).toBeLessThan(1)
        expect(photo.x + photo.width).toBeLessThanOrEqual(tools!.x)
        expect(photo.width).toBeGreaterThanOrEqual(44)
        expect(photo.height).toBeGreaterThanOrEqual(44)
        expect(photo.x + photo.width).toBeLessThanOrEqual(width)
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      )
      await page.locator('.lookbook-actions').scrollIntoViewIfNeeded()
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
      const actionBox = await page.locator('.lookbook-actions').boundingBox()
      const navBox = await page.getByRole('navigation').boundingBox()
      const utilityBox = await page.locator('.outfit-save-actions').boundingBox()
      await expect(page.locator('.stage-tools .lookbook-actions')).toHaveCount(1)
      await expect(page.locator('.lookbook-footer')).toHaveCount(0)
      expect(actionBox!.y).toBeGreaterThanOrEqual(utilityBox!.y + utilityBox!.height)
      expect(actionBox!.y + actionBox!.height).toBeLessThanOrEqual(navBox!.y)
      await page.evaluate(() => window.scrollTo(0, 0))
      if (width === 375) {
        await page.setViewportSize({ width, height: 900 })
        await page.screenshot({
          path: testInfo.outputPath(`scheme-${index + 1}.png`),
          animations: 'disabled',
        })
        await page.setViewportSize({ width, height: 812 })
      }
    }
  }
})
