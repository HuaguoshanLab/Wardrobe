import { Button } from '../../components/ui/button'
import type { ImportDraft, ImportRow } from './api'
import { importDetailsSchema } from './details-schema'

const defaults: ImportDraft = {
  ...importDetailsSchema.parse({}),
  category: null,
  name: null,
  color_codes: [],
  seasons: [],
  occasion_codes: [],
  style_codes: [],
  material: null,
  thickness: null,
  warmth: null,
  custom_tag_ids: [],
  availability: 'available',
  display_variant: 'original',
}
const labels: Record<keyof ImportDraft, string> = {
  category: '品类',
  name: '名称',
  color_codes: '颜色',
  seasons: '季节',
  occasion_codes: '场合',
  style_codes: '风格',
  material: '材质',
  thickness: '厚度',
  warmth: '保暖程度',
  custom_tag_ids: '自定义标签',
  availability: '状态',
  display_variant: '展示图片',
  subtype_name: '子类',
  source: '获得来源',
  acquired_on: '获得日期',
  price: '购入金额（元）',
  location: '收纳位置',
  condition: '衣物状况',
  fit: '合身情况',
  storage: '收纳状态',
  notes: '档案备注',
}

export function ImportFieldErrors({
  row,
  changes,
  onChange,
}: {
  row: ImportRow
  changes: Partial<ImportDraft>
  onChange: (next: Partial<ImportDraft>) => void
}) {
  const fields = (Object.keys(defaults) as (keyof ImportDraft)[]).filter(
    (field) => row.processing_errors[field] && !(field in changes),
  )
  if (!fields.length) return null
  return (
    <section aria-label="导入字段错误">
      <h2>这些字段需要处理</h2>
      <p>原文件中的错误值未采用。请重新填写，或明确重置为未知/默认值后保存。</p>
      {fields.map((field) => (
        <div key={field}>
          <p role="alert" className="error">
            {String(row.processing_errors[field])}
          </p>
          <Button
            variant="outline"
            onClick={() => onChange({ ...changes, [field]: defaults[field] })}
          >
            重置{labels[field]}
          </Button>
        </div>
      ))}
    </section>
  )
}
