import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router'
import { PageHeader } from '../../../components/ui/page-header'
import { getFeedback, getWear } from './api'
import { FeedbackEditor } from './editor'
import '../records.css'
import './feedback.css'

export function FeedbackPage() {
  const { recordId = '' } = useParams()
  const wear = useQuery({ queryKey: ['wear', recordId], queryFn: () => getWear(recordId) })
  const feedback = useQuery({
    queryKey: ['feedback', recordId],
    queryFn: () => getFeedback(recordId),
  })
  const [retry, setRetry] = useState(0)
  const back = wear.data
    ? `/collections?view=calendar&month=${wear.data.worn_on.slice(0, 7)}&date=${wear.data.worn_on}`
    : '/collections?view=calendar'
  return (
    <div className="subpage feedback-page">
      <PageHeader title="穿后反馈" backTo={back} backLabel="返回穿着日历" />
      {(wear.isPending || feedback.isPending) && <p role="status">正在读取实际穿着记录…</p>}
      {(wear.error || feedback.error) && (
        <p role="alert" className="error">
          {(wear.error || feedback.error)?.message}{' '}
          <button
            onClick={() => {
              void wear.refetch()
              void feedback.refetch()
              setRetry(retry + 1)
            }}
          >
            重新读取
          </button>
        </p>
      )}
      {wear.data && feedback.data && !wear.error && !feedback.error && (
        <FeedbackEditor
          key={`${recordId}.${retry}`}
          wear={wear.data}
          initial={feedback.data}
          reload={async () => {
            const result = await feedback.refetch()
            return result.isSuccess ? result.data : undefined
          }}
        />
      )}
      <p className="muted">反馈仅描述这次实际感受，不修改历史搭配或衣服属性。</p>
    </div>
  )
}
