import { useState } from 'react'
import { LockKeyhole } from 'lucide-react'
import { Sheet } from '../../components/ui/sheet'
import { OutfitStatus } from './task-status'
import { PieceAttributes } from './piece-attributes'
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
  const [failedImage, setFailedImage] = useState<string | null>(null)
  const imageAvailable = !!item.image_url && failedImage !== item.image_url
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
            {imageAvailable ? (
              <img
                src={item.image_url!}
                alt={name}
                draggable={false}
                onError={() => setFailedImage(item.image_url)}
              />
            ) : (
              <span>图片暂不可用</span>
            )}
            {locked && (
              <span className="piece-lock">
                <LockKeyhole size={14} aria-label="已锁定" />
              </span>
            )}
          </button>
        }
      >
        {imageAvailable ? (
          <img
            className="sheet-piece-image"
            src={item.image_url!}
            alt={`${name}详情`}
            onError={() => setFailedImage(item.image_url)}
          />
        ) : (
          <p className="notice">图片暂不可用</p>
        )}
        <p className="muted">{categories[item.slot] || item.slot} · 搭配保存时的单品</p>
        <PieceAttributes attributes={item.attributes} />
        <OutfitStatus controller={c} compact />
        {invalid && <p className="error">该单品当前不可用，历史图片仍保留。</p>}
        <p>
          {!selected
            ? '先选用这套，再替换其中的单品。'
            : locked
              ? '此单品已锁定。解锁后才可替换。'
              : '只替换这件，其他单品保持不变。'}
        </p>
        {selected && item.garment_id && (
          <label className="piece-lock-control">
            <input
              type="checkbox"
              checked={locked}
              disabled={c.busy}
              onChange={(e) =>
                c.patch({
                  locked_garment_ids: e.target.checked
                    ? [...(c.session?.locked_garment_ids ?? []), item.garment_id!]
                    : (c.session?.locked_garment_ids.filter((id) => id !== item.garment_id) ?? []),
                })
              }
            />
            锁定此单品<span>重搭时保留</span>
          </label>
        )}
        <Button
          disabled={!selected || locked || c.busy}
          onClick={async () => {
            if (await c.adjust('replace_items', [item.item_id], '')) setOpen(false)
          }}
        >
          只换这件
        </Button>
      </Sheet>
      <figcaption>
        {name}
        {invalid && <span className="error"> · 不可用</span>}
      </figcaption>
    </figure>
  )
}
