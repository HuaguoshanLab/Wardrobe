import './result.css'
import { Check } from 'lucide-react'
import { Link } from 'react-router'
import { RecordImage } from '../preview'
import type { ManualResult } from './state'

export function ManualSaved({ result, returnTo }: { result: ManualResult; returnTo: string }) {
  return (
    <section className="manual-success">
      <div className="manual-success-mark">
        <Check size={26} aria-hidden="true" />
      </div>
      <div role="status">
        <h2>{result.wear ? '穿着已记录' : '手动搭配已保存'}</h2>
        <p className="muted">
          {result.wear
            ? `这 ${result.revision.items.length} 件，已记入 ${result.wear.worn_on} 的穿着日历。`
            : '已留在搭配历史中，想穿时随时回来找。'}
        </p>
      </div>
      <div className="manual-saved-images" aria-label="已保存的搭配">
        {result.revision.items.map((item) => (
          <RecordImage
            key={item.item_id}
            src={item.image_url}
            name={String(item.attributes.name || '单品')}
          />
        ))}
      </div>
      {!result.wear && <p className="muted">仅保存搭配，还没有记为穿过。</p>}
      <div className="manual-success-actions">
        {result.wear && (
          <Link
            className="button button-primary"
            to={`/collections?view=calendar&month=${result.wear.worn_on.slice(0, 7)}&date=${result.wear.worn_on}`}
          >
            查看穿着日历
          </Link>
        )}
        <Link
          className={`button ${result.wear ? 'button-outline' : 'button-primary'}`}
          to={`/collections/${result.revision.id}`}
        >
          查看保存的搭配
        </Link>
        <Link className="button button-outline" to={returnTo}>
          返回{returnTo.startsWith('/wardrobe') ? '衣橱' : '穿搭记录'}
        </Link>
      </div>
    </section>
  )
}
