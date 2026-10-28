import { expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OutfitStatus } from './task-status'
import type { OutfitController } from './use-outfits'

it('keeps cancellation pending until the server confirms and never submits on render', async () => {
  const cancel = vi.fn()
  const controller = {
    active: true,
    submitting: false,
    pending: null,
    error: null,
    notice: '',
    cancel: { isPending: false, mutate: cancel },
    job: { status: 'running', kind: 'outfit_generate', error: null, result: null },
  } as unknown as OutfitController
  const view = render(<OutfitStatus controller={controller} />)
  expect(screen.getByRole('status')).toHaveTextContent('正在为你搭配')
  expect(cancel).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: '请求取消' }))
  expect(cancel).toHaveBeenCalledTimes(1)
  view.rerender(
    <OutfitStatus
      controller={{ ...controller, job: { ...controller.job!, status: 'cancel_requested' } }}
    />,
  )
  expect(screen.getByRole('status')).toHaveTextContent('等待任务确认')
  expect(screen.getByRole('button', { name: '取消中…' })).toBeDisabled()
  view.rerender(
    <OutfitStatus
      controller={{
        ...controller,
        active: false,
        job: { ...controller.job!, status: 'cancelled' },
      }}
    />,
  )
  expect(screen.getByText('任务状态：已取消')).toBeVisible()
  expect(screen.queryByRole('button', { name: '取消中…' })).not.toBeInTheDocument()
  expect(cancel).toHaveBeenCalledTimes(1)
})
