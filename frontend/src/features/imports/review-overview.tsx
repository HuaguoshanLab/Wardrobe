import { StepProgress } from '../../components/ui/step-progress'
import type { z } from 'zod'
import type { batchSchema } from './api'

export function ReviewOverview({
  batch,
  processing,
  complete,
}: {
  batch: z.infer<typeof batchSchema>
  processing: boolean
  complete: boolean
}) {
  const steps =
    batch.source === 'photos'
      ? ([
          ['conversion_status', '图片转换'],
          ['analysis_status', '属性识别'],
          ['cutout_status', '去背景'],
        ] as const)
      : ([
          ['conversion_status', '图片转换'],
          ['cutout_status', '去背景'],
        ] as const)
  return (
    <>
      <StepProgress
        label="录入步骤"
        steps={['选择文件', '检查修改', '确认入库']}
        current={complete ? 2 : 1}
      />
      <div className="import-review-heading">
        <strong>
          {batch.source === 'photos' ? '照片' : 'Excel'}导入 <span>· {batch.rows.length} 件</span>
        </strong>
        <p>先看图片与品类，再确认入库。其他资料可以以后补。</p>
      </div>
      {processing && (
        <section className="import-processing" aria-label="本批处理进度">
          <strong role="status">正在处理图片与属性</strong>
          <p>已就绪的单品可以先核对。刷新不会重复识别。</p>
          {batch.rows.length > 0 && (
            <dl>
              {steps.map(([key, label]) => {
                const succeeded = batch.rows.filter((row) => row[key] === 'succeeded').length
                const failed = batch.rows.filter((row) =>
                  ['failed', 'interrupted', 'cancelled'].includes(row[key]),
                ).length
                return (
                  <div key={key}>
                    <dt>{label}</dt>
                    <dd>
                      {succeeded} / {batch.rows.length} 已完成
                      {failed > 0 && <small> · {failed} 件未完成</small>}
                    </dd>
                  </div>
                )
              })}
            </dl>
          )}
        </section>
      )}
    </>
  )
}
