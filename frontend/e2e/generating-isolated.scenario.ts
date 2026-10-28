import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

function marker(name: string) {
  execFileSync('docker', [
    'exec',
    'wardrobe-p6-regression-worker-1',
    'touch',
    `/data/control/p6-${name}`,
  ])
}

test('A-12: running generation survives reload and a new browser context without another call', async ({
  page,
  request,
  browser,
}) => {
  expect(process.env.P6_ISOLATED_REGRESSION).toBe('1')
  const upload = await request.post('/api/v1/imports/photos', {
    headers: { 'Idempotency-Key': randomUUID() },
    multipart: {
      files: {
        name: 'running.png',
        mimeType: 'image/png',
        buffer: await readFile(new URL('./fixtures/shirt.png', import.meta.url)),
      },
    },
  })
  expect(upload.ok()).toBe(true)
  const bid = (await upload.json()).data.import_batch_id
  const batch = async () => (await (await request.get(`/api/v1/imports/${bid}`)).json()).data
  await expect.poll(async () => (await batch()).job_status, { timeout: 60000 }).toBe('succeeded')
  const row = (await batch()).rows[0]
  const confirmed = await request.post(`/api/v1/imports/${bid}/confirm`, {
    headers: { 'Idempotency-Key': randomUUID() },
    data: { rows: [{ row_id: row.id, expected_version: row.version }] },
  })
  expect((await confirmed.json()).data.rows[0].status).toBe('confirmed')
  const created = await request.post('/api/v1/outfit-sessions', {
    headers: { 'Idempotency-Key': randomUUID() },
    data: { requirements: { weather_override: { temperature_c: 20, condition: 'clear' } } },
  })
  expect(created.ok()).toBe(true)
  const session = (await created.json()).data
  marker('pause-next-outfit')
  let jobId = ''
  try {
    const response = await request.post(`/api/v1/outfit-sessions/${session.id}/generate`, {
      headers: { 'Idempotency-Key': randomUUID() },
      data: { expected_version: session.version },
    })
    expect(response.ok()).toBe(true)
    jobId = (await response.json()).data.job_id
    const job = async () => (await (await request.get(`/api/v1/jobs/${jobId}`)).json()).data
    await expect.poll(async () => (await job()).status).toBe('running')
    await expect
      .poll(() =>
        execFileSync(
          'docker',
          [
            'exec',
            'wardrobe-p6-regression-worker-1',
            'python',
            '-c',
            "from pathlib import Path; print(Path('/data/control/p6-outfit-paused').exists())",
          ],
          { encoding: 'utf8' },
        ).trim(),
      )
      .toBe('True')
    let writes = 0
    const watch = (p: typeof page) =>
      p.on('request', (r) => {
        if (!['GET', 'HEAD'].includes(r.method())) writes++
      })
    watch(page)
    let disconnected = 0
    await page.route('**/api/v1/jobs/*/events*', async (route) => {
      disconnected++
      await route.abort('failed')
    })
    await page.goto(`/outfits/${session.id}`)
    await expect(page.getByRole('button', { name: '请求取消' })).toBeEnabled()
    await expect.poll(() => disconnected).toBeGreaterThan(0)
    await expect(page.getByText('事件连接中断，正在只读查询任务恢复进度。')).toBeVisible()
    await page.reload()
    expect((await job()).status).toBe('running')
    await page.close()
    const other = await browser.newContext()
    try {
      const reopened = await other.newPage()
      watch(reopened)
      let expired = 0
      await reopened.route('**/api/v1/jobs/*/events*', async (route) => {
        expired++
        await route.fulfill({
          status: 410,
          contentType: 'application/json',
          body: JSON.stringify({
            error: { code: 'EVENT_CURSOR_EXPIRED', message: 'Injected expired cursor' },
            request_id: randomUUID(),
          }),
        })
      })
      await reopened.goto(`http://localhost:8099/outfits/${session.id}`)
      await expect(reopened.getByRole('button', { name: '请求取消' })).toBeEnabled()
      expect((await job()).status).toBe('running')
      await expect.poll(() => expired).toBeGreaterThan(0)
      marker('resume-outfit')
      await expect.poll(async () => (await job()).status, { timeout: 30000 }).toBe('succeeded')
      await expect(reopened.locator('.lookbook').first()).toBeVisible()
      const saved = (await (await request.get(`/api/v1/outfit-sessions/${session.id}`)).json()).data
      expect(saved.current_job_id).toBe(jobId)
      expect(writes).toBe(0)
      expect(jobId).toMatch(/^[a-f0-9-]{36}$/)
      const count = execFileSync(
        'docker',
        [
          'exec',
          'wardrobe-p6-regression-db-1',
          'psql',
          '-U',
          'wardrobe',
          '-d',
          'regression_test',
          '-Atc',
          `select count(*) from outfit_model_calls where job_id='${jobId}'`,
        ],
        { encoding: 'utf8' },
      ).trim()
      expect(count).toBe('1')
    } finally {
      await other.close()
    }
  } finally {
    execFileSync('docker', [
      'exec',
      'wardrobe-p6-regression-worker-1',
      'rm',
      '-f',
      '/data/control/p6-pause-next-outfit',
    ])
    marker('resume-outfit')
  }
})
