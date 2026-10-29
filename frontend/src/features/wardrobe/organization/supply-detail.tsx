import { useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Button } from '../../../components/ui/button'
import { PageHeader } from '../../../components/ui/page-header'
import { Sheet, SheetFooter } from '../../../components/ui/sheet'
import { OperationNotice } from '../../../components/ui/operation-notice'
import { useOperation } from '../../../lib/use-operation'
import type { Garment } from '../api'
import { GarmentPicker } from './garment-picker'
import { getSupply, seasonLabel, supplyLabels } from './api'
import { SupplyProgress } from './supply-progress'
import './organization.css'

export function SupplyDetailPage() {
  const { id = '' } = useParams()
  const actionFocus = useRef<HTMLButtonElement | null>(null)
  const titleFocus = useRef<HTMLHeadingElement | null>(null)
  const [pick, setPick] = useState(false)
  const [selected, setSelected] = useState<Garment | null>(null)
  const [cancel, setCancel] = useState(false)
  const query = useQuery({ queryKey: ['supply-plan', id], queryFn: () => getSupply(id) })
  const operation = useOperation(`supply-actions.${id}`, () => {
    setPick(false)
    setSelected(null)
    setCancel(false)
  })
  const p = query.data
  return (
    <section className="organization-page">
      <PageHeader title="补充计划" backTo="/wardrobe/organization" backLabel="返回整理清单" />
      {!p ? (
        <p role={query.error ? 'alert' : 'status'}>
          {query.error?.message ?? '正在读取计划…'}
          {query.error && <Button onClick={() => void query.refetch()}>重新读取</Button>}
        </p>
      ) : (
        <>
          <article className="organization-card supply-overview">
            <div className="organization-section">
              <span className="organization-badge" data-state={p.status}>
                {supplyLabels[p.status]}
              </span>
              <Link className="text-link" to={`/wardrobe/organization/plans/${id}/edit`}>
                编辑计划
              </Link>
            </div>
            <h2 tabIndex={-1} ref={titleFocus}>
              {p.name}
            </h2>
            <SupplyProgress plan={p} />
            <div className="organization-facts">
              <div>
                <span>还有 {p.remaining} 件待完成</span>
                <strong>
                  {p.remaining}
                  <small> 件待完成</small>
                </strong>
              </div>
              <div>
                <span>总预算</span>
                <strong>{p.budget === null ? '未设置' : `¥ ${p.budget}`}</strong>
              </div>
            </div>
            {p.reason && <p className="organization-evidence">{p.reason}</p>}
            {p.notes && (
              <details className="organization-disclosure">
                <summary>计划备注</summary>
                <p className="organization-notes">{p.notes}</p>
              </details>
            )}
          </article>
          <section className="organization-card">
            <h3>已关联入库 · {p.linked.length} 件</h3>
            {p.linked.map((g) => (
              <p key={g.id}>
                {g.archived ? (
                  <span>{g.name} · 已归档，完成记录保留</span>
                ) : (
                  <Link
                    to={`/wardrobe/${g.id}`}
                    state={{ organizationReturn: `/wardrobe/organization/plans/${id}` }}
                  >
                    {g.name}
                  </Link>
                )}
              </p>
            ))}
            {!p.linked.length && (
              <p className="muted">还没有关联正式单品。已购待入库仍不算库存。</p>
            )}
            {p.remaining > 0 && (
              <>
                <div className="organization-actions">
                  <Button
                    disabled={operation.busy}
                    onClick={(e) => {
                      actionFocus.current = e.currentTarget
                      setPick(true)
                    }}
                  >
                    关联正式单品
                  </Button>
                  <Link className="button button-outline" to={`/imports?return_supply=${id}`}>
                    先录入新衣服
                  </Link>
                </div>
                <p className="muted">
                  新衣服先完成照片 / Excel
                  审核，确认入库后回到这里关联。每件衣服只能关联一个补充计划。
                </p>
              </>
            )}
          </section>
          <details className="organization-card organization-disclosure">
            <summary>关联的季节需求 · {p.sources.length} 项</summary>
            {p.sources.length ? (
              p.sources.map((s) => (
                <p key={s.id}>
                  <Link
                    to={`/wardrobe/inventory?${new URLSearchParams({ season: s.season, focus: s.id })}`}
                  >
                    {seasonLabel(s.season)}季 · {s.name}
                  </Link>
                  {!s.active && '（已停用，原来源保留）'}
                </p>
              ))
            ) : (
              <p className="muted">手工计划，没有关联季节需求。</p>
            )}
            <p className="muted">目标变化不会自动删除计划；一批衣服可覆盖多个需求。</p>
          </details>
          <OperationNotice operation={operation} />
          {(operation.error || operation.pending) && (
            <Button
              variant="outline"
              disabled={operation.sending}
              onClick={async () => {
                const latest = await query.refetch()
                if (!latest.isError) {
                  operation.discard()
                  setSelected(null)
                  setPick(false)
                  setCancel(false)
                }
              }}
            >
              读取最新内容后重新选择
            </Button>
          )}
          {p.remaining > 0 && (
            <Button
              variant="outline"
              disabled={operation.busy}
              onClick={(e) => {
                actionFocus.current = e.currentTarget
                setCancel(true)
              }}
            >
              取消剩余 {p.remaining} 件
            </Button>
          )}
          <Sheet
            title={selected ? '确认关联入库' : '选择已正式入库的衣服'}
            finalFocus={() =>
              actionFocus.current?.isConnected ? actionFocus.current : titleFocus.current
            }
            open={pick}
            trigger={<button hidden type="button" />}
            onOpenChange={(open) => {
              if (!operation.sending) {
                setPick(open)
                if (!open) setSelected(null)
              }
            }}
          >
            {selected ? (
              <>
                <div className="organization-item">
                  <img src={selected.image_url} alt="" />
                  <div>
                    <h3>{selected.name ?? '未命名单品'}</h3>
                    <p>将这件衣服关联到“{p.name}”，完成计划中的 1 件。</p>
                  </div>
                </div>
                <SheetFooter>
                  <Button
                    disabled={operation.busy}
                    onClick={() =>
                      operation.send(`/supply-plans/${id}/link`, 'POST', {
                        expected_version: p.version,
                        garment_id: selected.id,
                        garment_version: selected.version,
                      })
                    }
                  >
                    确认关联这件
                  </Button>
                  <Button
                    variant="outline"
                    disabled={operation.sending}
                    onClick={() => setSelected(null)}
                  >
                    重新选择
                  </Button>
                </SheetFooter>
                <OperationNotice operation={operation} />
              </>
            ) : (
              <GarmentPicker excluded={p.linked.map((g) => g.id)} onSelect={setSelected} />
            )}
          </Sheet>
          <Sheet
            title="取消剩余补充数量？"
            finalFocus={() =>
              actionFocus.current?.isConnected ? actionFocus.current : titleFocus.current
            }
            open={cancel}
            trigger={<button hidden type="button" />}
            onOpenChange={(open) => {
              if (!operation.sending) setCancel(open)
            }}
          >
            <p>
              取消“{p.name}”剩余的 {p.remaining} 件；已关联的 {p.linked.length} 件和现有衣服保留。
            </p>
            <SheetFooter>
              <Button
                disabled={operation.busy}
                onClick={() =>
                  operation.send(`/supply-plans/${id}/cancel-remaining`, 'POST', {
                    expected_version: p.version,
                  })
                }
              >
                确认取消剩余数量
              </Button>
            </SheetFooter>
            <OperationNotice operation={operation} />
          </Sheet>
        </>
      )}
    </section>
  )
}
