import { useState } from 'react'
import { expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RotationChoice } from './rotation-choice'
import type { Requirements } from './api'

it('native keyboard selection changes mode and its explanation together', async () => {
  function Form() {
    const [mode, setMode] = useState<Requirements['rotation_mode']>('normal')
    return <RotationChoice value={mode} onChange={setMode} />
  }
  const user = userEvent.setup()
  render(<Form />)
  await user.tab()
  expect(screen.getByRole('radio', { name: /正常推荐/ })).toHaveFocus()
  await user.keyboard('{ArrowRight}')
  expect(screen.getByRole('radio', { name: /尽量避开近期组合/ })).toBeChecked()
  expect(screen.getByText('参考近 7 天的实际记录；只换鞋包，不算主体组合变化。')).toBeVisible()
})
it('an active task disables the entire choice without changing the saved selection', async () => {
  const change = vi.fn()
  render(
    <fieldset disabled>
      <RotationChoice value="less_worn" onChange={change} />
    </fieldset>,
  )
  await userEvent.click(screen.getByRole('radio', { name: /正常推荐/ }))
  expect(screen.getByRole('radio', { name: /优先近期少穿/ })).toBeChecked()
  expect(change).not.toHaveBeenCalled()
})
