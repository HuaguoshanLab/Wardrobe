import { afterEach, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { FeedbackSuggestion, stageFeedbackSuggestion } from './feedback-suggestion'
afterEach(() => localStorage.clear())
function Test({ initial = '已有本次要求' }: { initial?: string }) {
  const [notes, setNotes] = useState(initial)
  return (
    <>
      <FeedbackSuggestion notes={notes} onApply={setNotes} />
      <output>{notes}</output>
    </>
  )
}
it('requires explicit draft insertion and keeps prior notes without duplicating on reload', async () => {
  stageFeedbackSuggestion('偏热，想更透气')
  const user = userEvent.setup()
  const view = render(<Test />)
  expect(screen.getByRole('status')).toHaveTextContent('已有本次要求')
  await user.click(screen.getByRole('button', { name: '加入本次补充' }))
  expect(screen.getByText('已有本次要求 偏热，想更透气')).toBeInTheDocument()
  expect(localStorage.getItem('wardrobe.feedback.next')).toBeNull()
  view.unmount()
  render(<Test initial={'已有本次要求\n偏热，想更透气'} />)
  expect(screen.queryByRole('button', { name: '加入本次补充' })).not.toBeInTheDocument()
})
it('blocks overflow without truncating or applying', () => {
  stageFeedbackSuggestion('新'.repeat(1000))
  render(<Test />)
  expect(screen.getByRole('button', { name: '加入本次补充' })).toBeDisabled()
  expect(screen.getByRole('status')).toHaveTextContent('已有本次要求')
})
it('keeps the editor when text is cleared, including after refresh', async () => {
  stageFeedbackSuggestion('准备重写的感受')
  const user = userEvent.setup()
  const view = render(<Test />)
  await user.clear(screen.getByLabelText('待加入的穿后反馈'))
  expect(screen.getByRole('button', { name: '加入本次补充' })).toBeDisabled()
  view.unmount()
  render(<Test />)
  await user.type(screen.getByLabelText('待加入的穿后反馈'), '改成新的参考')
  await user.click(screen.getByRole('button', { name: '加入本次补充' }))
  expect(screen.getByText('已有本次要求 改成新的参考')).toBeInTheDocument()
})
