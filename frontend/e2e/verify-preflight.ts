import { execFileSync } from 'node:child_process'
import { request } from '@playwright/test'

export default async function preflight() {
  const project = process.env.WARDROBE_VERIFY_PROJECT
  const baseURL = process.env.E2E_BASE_URL
  if (!project || !/^wardrobe-verify-[a-z0-9]{8}$/.test(project) || !baseURL)
    throw new Error('Run this suite through make verify')
  const [container] = JSON.parse(
    execFileSync('docker', ['inspect', `${project}-web-1`], { encoding: 'utf8' }),
  )
  const [binding] = container.NetworkSettings.Ports['80/tcp'] ?? []
  if (
    container.Config.Labels['com.docker.compose.project'] !== project ||
    container.Config.Labels['com.docker.compose.service'] !== 'web' ||
    binding?.HostIp !== '127.0.0.1' ||
    baseURL !== `http://127.0.0.1:${binding.HostPort}`
  )
    throw new Error('Browser target does not match the isolated Compose web port')
  const context = await request.newContext({ baseURL })
  try {
    const response = await context.get('/api/v1/capabilities')
    if (!response.ok()) throw new Error('Isolated capabilities endpoint is unavailable')
    const { data } = await response.json()
    if (
      data.provider_mode !== 'fake' ||
      data.recognition !== 'fake' ||
      data.weather !== 'unconfigured'
    )
      throw new Error('Browser target must use Fake providers and unconfigured weather')
  } finally {
    await context.dispose()
  }
}
