import { execFileSync } from 'node:child_process'
import { request } from '@playwright/test'

export default async function preflight() {
  for (const name of ['api', 'worker', 'controller', 'db', 'web']) {
    const [container] = JSON.parse(
      execFileSync('docker', ['inspect', `wardrobe-p6-regression-${name}-1`], { encoding: 'utf8' }),
    )
    if (container.Config.Labels['com.docker.compose.project'] !== 'wardrobe-p6-regression')
      throw new Error('Unexpected Compose project')
    if (
      name !== 'web' &&
      JSON.stringify(Object.keys(container.NetworkSettings.Networks)) !==
        JSON.stringify(['wardrobe-p6-regression_default'])
    )
      throw new Error('Backend must only use the isolated internal network')
    for (const mount of container.Mounts)
      if (mount.Type === 'volume' && !mount.Name.startsWith('wardrobe-p6-regression_'))
        throw new Error('Refusing a shared volume')
    if (['api', 'worker', 'controller'].includes(name)) {
      const env: string[] = container.Config.Env
      if (
        !env.includes('WARDROBE_PROVIDER_MODE=fake') ||
        !env.includes('WARDROBE_RECOGNITION_MODE=fake')
      )
        throw new Error('Both providers must be Fake')
      if (
        env.some((value) =>
          /^WARDROBE_(QWEN_API_KEY|QWEATHER_API_KEY|QWEATHER_TOKEN)=.+/.test(value),
        )
      )
        throw new Error('Real credentials are forbidden')
    }
  }
  const [network] = JSON.parse(
    execFileSync('docker', ['network', 'inspect', 'wardrobe-p6-regression_default'], {
      encoding: 'utf8',
    }),
  )
  if (!network.Internal) throw new Error('Regression network must block external services')
  const context = await request.newContext({ baseURL: 'http://localhost:8099' })
  try {
    const response = await context.get('/api/v1/capabilities')
    const { data } = await response.json()
    if (
      data.provider_mode !== 'fake' ||
      data.recognition !== 'fake' ||
      data.weather !== 'unconfigured'
    )
      throw new Error('HTTP target is not the isolated Fake configuration')
  } finally {
    await context.dispose()
  }
}
