import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { Link } from 'react-router'
import { Button } from '../../components/ui/button'
import { getGarment, GarmentImage } from '../wardrobe'
import './anchor.css'

export function useAnchor(id: string | null) {
  const valid = z.uuid().safeParse(id).success
  const query = useQuery({
    queryKey: ['garments', 'anchor', id],
    queryFn: () => getGarment(id!),
    enabled: id !== null && valid,
    refetchInterval: id ? 10000 : false,
  })
  const item = query.data
  const blocked =
    id !== null &&
    (!valid ||
      !item ||
      query.isError ||
      item.ownership !== 'owned' ||
      item.is_demo ||
      item.availability !== 'available')
  return { query, blocked, valid, id }
}
export function AnchorNotice({
  anchor,
  busy,
  onRemove,
  returnTo,
}: {
  anchor: ReturnType<typeof useAnchor>
  busy: boolean
  onRemove: () => void
  returnTo?: string | null
}) {
  if (anchor.id === null) return null
  const { query, blocked, valid } = anchor
  const item = query.data
  const reason = item?.is_demo
    ? '示例单品不能参与正式搭配'
    : item?.ownership === 'retired'
      ? '这件衣服已退出衣橱'
      : '这件衣服暂不可穿'
  return (
    <section
      id="anchor-notice"
      tabIndex={-1}
      className="panel anchor-notice"
      aria-label="指定搭配单品"
    >
      <h2>围绕这件搭配</h2>
      {!valid ? (
        <p role="alert">指定单品无效，请移除后重新选择。</p>
      ) : query.isPending ? (
        <p role="status">正在核对单品状态…</p>
      ) : query.isError ? (
        <div role="alert">
          <p>{query.error.message}</p>
          <Button variant="outline" onClick={() => void query.refetch()}>
            重新核对单品
          </Button>
        </div>
      ) : (
        query.data && (
          <>
            <div className="anchor-item">
              <GarmentImage
                key={query.data.image_url}
                src={query.data.image_url}
                alt=""
                className="anchor-image"
                retry={false}
              />
              <div>
                <strong>{query.data.name || '指定单品'}</strong>
                <p className="anchor-availability">{blocked ? reason : '可穿 · 生成时保留这件'}</p>
              </div>
            </div>
            <p className="anchor-help" role={blocked ? 'alert' : undefined}>
              {blocked
                ? '暂时不能生成。可返回利用情况处理状态，或移除指定后继续。'
                : '先填写下面的条件，点击“生成搭配”才开始；已有搭配仍保留。'}
            </p>
          </>
        )
      )}
      <div className="anchor-actions">
        <Button variant="outline" disabled={busy} onClick={onRemove}>
          移除指定单品
        </Button>
        {blocked && returnTo && (
          <Link className="text-link" to={returnTo}>
            回到列表处理
          </Link>
        )}
      </div>
      <p className="anchor-footnote">移除不会清空已填写的条件。</p>
    </section>
  )
}
