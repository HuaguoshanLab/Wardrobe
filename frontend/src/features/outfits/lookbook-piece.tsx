import { useState } from 'react'
import { LockKeyhole, Plus } from 'lucide-react'
import { Sheet } from '../../components/ui/sheet'
import { Button } from '../../components/ui/button'
import type { Revision } from './api'
import type { OutfitController } from './use-outfits'

const categories: Record<string, string> = {
  top: '上装',
  bottom: '下装',
  dress: '连衣裙',
  outerwear: '外套',
  shoes: '鞋',
  bag: '包',
  hat: '帽子',
  scarf: '围巾',
  belt: '腰带',
  jewelry: '首饰',
  other_accessory: '配饰',
}
export function LookbookPiece({
  item,
  controller: c,
  selected,
}: {
  item: Revision['items'][number]
  controller: OutfitController
  selected: boolean
}) {
  const [open, setOpen] = useState(false)
  const name = String(item.attributes.name || categories[item.slot] || item.slot)
  const locked =
    selected && !!item.garment_id && !!c.session?.locked_garment_ids.includes(item.garment_id)
  const invalid = !!item.garment_id && !!c.session?.invalid_garment_ids.includes(item.garment_id)
  return (
    <figure className={`lookbook-piece piece-${item.slot}`}>
      <Sheet
        title={name}
        open={open}
        onOpenChange={setOpen}
        trigger={
          <button className="piece-photo" aria-label={`查看${name}`}>
            {item.image_url ? (
              <img src={item.image_url} alt={name} draggable={false} />
            ) : (
              <span>图片暂不可用</span>
            )}
            <span className="piece-lock">
              {locked ? (
                <LockKeyhole size={14} aria-label="已锁定" />
              ) : (
                <Plus size={14} aria-hidden="true" />
              )}
            </span>
          </button>
        }
      >
        {item.image_url && (
          <img className="sheet-piece-image" src={item.image_url} alt={`${name}详情`} />
        )}
        <p>{categories[item.slot] || item.slot} · 搭配中的单品快照</p>
        {invalid && <p className="error">该单品当前不可用，历史图片仍保留。</p>}
        <p>
          {!selected
            ? '先选用这套，再替换其中的单品。'
            : locked
              ? '此单品已锁定，请到“调整这套”解锁后再替换。'
              : '只替换这件，其他单品保持不变。'}
        </p>
        <Button
          disabled={!selected || locked || c.busy}
          onClick={() => {
            c.adjust('replace_items', [item.item_id], '')
            setOpen(false)
          }}
        >
          只替换此项
        </Button>
      </Sheet>
      <figcaption>
        {name}
        {invalid && <span className="error"> · 不可用</span>}
      </figcaption>
    </figure>
  )
}
