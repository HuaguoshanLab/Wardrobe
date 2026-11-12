import { useQueries } from '@tanstack/react-query'
import { Link } from 'react-router'
import { getRevision } from './api'
import { GarmentImage } from '../wardrobe'
import { Button } from '../../components/ui/button'

export function ReferenceResults({ ids }: { ids: string[] }) {
  const queries = useQueries({
    queries: ids.map((id) => ({
      queryKey: ['reference-revision', id],
      queryFn: () => getRevision(id),
    })),
  })
  if (!ids.length) return null
  return (
    <section className="reference-results">
      <h2>衣橱里的近似搭配</h2>
      <p>使用真实单品，不保证同款；天气与实际叠穿效果需另行核对。</p>
      {queries.map((q, i) => (
        <article key={ids[i]} className="panel">
          {q.isPending && <p role="status">正在读取方案…</p>}
          {q.error && (
            <p role="alert">
              {q.error.message}
              <Button onClick={() => void q.refetch()}>重试</Button>
            </p>
          )}
          {q.data && (
            <>
              <h3>
                方案 {i + 1}
                {q.data.provider_mode === 'fake' ? ' · 模拟结果' : ''}
              </h3>
              <div className="reference-pieces">
                {q.data.items.map((item) => (
                  <div key={item.item_id}>
                    <GarmentImage
                      src={item.image_url ?? ''}
                      alt={String(item.attributes.name || '衣橱单品')}
                    />
                    <span>{String(item.attributes.name || '衣橱单品')}</span>
                  </div>
                ))}
              </div>
              <p className="reference-evidence">{q.data.reason}</p>
              <h3>缺少或无法核对的部分</h3>
              {q.data.unmet_requirements.length ? (
                <ul>
                  {q.data.unmet_requirements.map((m, j) => (
                    <li key={j}>{m}</li>
                  ))}
                </ul>
              ) : (
                <p>已记录的属性与所选线索相符，未确认同款或合身效果。</p>
              )}
              <Link className="button button-outline" to={`/collections/${q.data.id}`}>
                查看、收藏或记录穿着
              </Link>
            </>
          )}
        </article>
      ))}
    </section>
  )
}
