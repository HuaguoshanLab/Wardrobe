import type { Supply } from './api'

export function SupplyProgress({ plan }: { plan: Supply }) {
  const linked = plan.linked.length
  return (
    <div className="supply-meter">
      <div className="supply-meter-track" aria-hidden="true">
        <span style={{ width: `${(linked / plan.quantity) * 100}%` }} />
        <span
          className="supply-meter-cancelled"
          style={{ width: `${(plan.cancelled_quantity / plan.quantity) * 100}%` }}
        />
      </div>
      <div className="supply-meter-labels">
        <span>
          <strong>{linked}</strong> / {plan.quantity} 件已入库关联
        </span>
        <span>{plan.remaining > 0 ? `还差 ${plan.remaining} 件完成` : '本次计划已结束'}</span>
      </div>
      {plan.cancelled_quantity > 0 && (
        <small>其中 {plan.cancelled_quantity} 件已取消补充，未计入库存</small>
      )}
    </div>
  )
}
