import { useForm } from 'react-hook-form'
import { useQuery } from '@tanstack/react-query'
import { Button } from '../../components/ui/button'
import { getTags, getTaxonomy, type Attributes } from './api'

const labels: Record<string, string> = {
  category: '品类',
  color_codes: '颜色',
  seasons: '季节',
  occasion_codes: '场合',
  style_codes: '风格',
  material: '材质',
  thickness: '厚度',
  warmth: '保暖程度',
  availability: '状态',
}
const multi = new Set(['color_codes', 'seasons', 'occasion_codes', 'style_codes'])
type Field = keyof Attributes

export function AttributeForm({
  initial,
  onSave,
  busy,
  hasCutout,
  label = '保存修改',
}: {
  initial: Attributes
  onSave: (changes: Partial<Attributes>) => void
  busy: boolean
  hasCutout: boolean
  label?: string
}) {
  const taxonomy = useQuery({ queryKey: ['taxonomies'], queryFn: getTaxonomy })
  const tags = useQuery({ queryKey: ['tags'], queryFn: getTags })
  const {
    register,
    handleSubmit,
    formState: { dirtyFields },
    reset,
  } = useForm<Attributes>({ defaultValues: initial })
  return (
    <form
      className="attribute-form"
      onSubmit={handleSubmit((values) => {
        const changes: Partial<Attributes> = {}
        for (const field of Object.keys(dirtyFields) as Field[])
          Object.assign(changes, { [field]: values[field] })
        onSave(changes)
      })}
    >
      <label>
        名称
        <input
          {...register('name', {
            setValueAs: (v) => (typeof v === 'string' ? v.trim() || null : null),
          })}
          maxLength={100}
          placeholder="可不填写"
        />
      </label>
      <div className="attribute-grid">
        {Object.entries(labels).map(([key, label]) => {
          const field = key as Field
          const choices = taxonomy.data?.fields[key] ?? {}
          const value = initial[field]
          return (
            <label key={key}>
              {label}
              {field === 'category' ? ' *' : ''}
              <select
                aria-label={label}
                multiple={multi.has(key)}
                {...register(field, { setValueAs: multi.has(key) ? undefined : (v) => v || null })}
              >
                {!multi.has(key) && key !== 'availability' && (
                  <option value="">未知 / 未填写</option>
                )}
                {typeof value === 'string' && value && !choices[value] && (
                  <option value={value}>{value}（需修正）</option>
                )}
                {Object.entries(choices).map(([code, text]) => (
                  <option key={code} value={code}>
                    {text}
                  </option>
                ))}
              </select>
              {multi.has(key) && <small>可多选；留空表示未知</small>}
            </label>
          )
        })}
      </div>
      <label>
        自定义标签
        <select multiple {...register('custom_tag_ids')}>
          {tags.data?.map((tag) => (
            <option key={tag.id} value={tag.id}>
              {tag.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        展示图片
        <select {...register('display_variant')}>
          <option value="original">原图视图</option>
          <option value="cutout" disabled={!hasCutout}>
            去背景图{!hasCutout ? '（尚不可用）' : ''}
          </option>
        </select>
      </label>
      <div className="actions">
        <Button type="submit" disabled={busy}>
          {label}
        </Button>
        <Button type="button" variant="outline" onClick={() => reset(initial)} disabled={busy}>
          放弃草稿
        </Button>
      </div>
    </form>
  )
}
