import { useQuery } from '@tanstack/react-query'
import { getTaxonomy } from '../wardrobe'
import type { Revision } from './api'

const fields = {
  color_codes: '颜色',
  material: '材质',
  thickness: '厚薄',
  warmth: '保暖',
  seasons: '季节',
  style_codes: '风格',
}
export function PieceAttributes({
  attributes,
}: {
  attributes: Revision['items'][number]['attributes']
}) {
  const taxonomy = useQuery({ queryKey: ['taxonomy'], queryFn: getTaxonomy })
  return (
    <dl className="piece-attributes">
      {Object.entries(fields).map(([key, label]) => {
        const value = attributes[key]
        const values = Array.isArray(value) ? value : value ? [value] : []
        return (
          <div key={key}>
            <dt>{label}</dt>
            <dd>
              {values.length
                ? values.map((v) => taxonomy.data?.fields[key]?.[String(v)] ?? String(v)).join('、')
                : '未标注'}
            </dd>
          </div>
        )
      })}
    </dl>
  )
}
