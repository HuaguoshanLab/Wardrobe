import { useId, useState } from 'react'
import { z } from 'zod'
import { SheetFooter } from '../../../components/ui/sheet'
import { Button } from '../../../components/ui/button'
import { fieldsSchema, getTemplate, type Fields, type Template } from './api'
import { TemplateFields, invalidFields, repairFields, type Tag, type Vocabulary } from './fields'
export const editorSchema = z.object({
  id: z.uuid().nullable(),
  version: z.int().nullable(),
  name: z.string(),
  fields: fieldsSchema,
  unsupported: z.boolean(),
})
export type Editor = z.infer<typeof editorSchema>
const key = 'wardrobe.template.editor'
export function readEditor(): Editor | null {
  try {
    return editorSchema.parse(JSON.parse(localStorage.getItem(key) ?? 'null'))
  } catch {
    return null
  }
}
export function storeEditor(value: Editor | null) {
  if (value) localStorage.setItem(key, JSON.stringify(value))
  else localStorage.removeItem(key)
}
export function editTemplate(t: Template, fallback: Fields): Editor {
  const parsed = fieldsSchema.safeParse(t.conditions)
  // Never silently sanitize unsupported stored data. User must explicitly choose correction.
  return {
    id: t.id,
    version: t.version,
    name: t.name,
    fields: parsed.success ? parsed.data : fallback,
    unsupported: !parsed.success,
  }
}
export function TemplateEditor({
  value,
  onChange,
  taxonomy,
  tags,
  busy,
  onSave,
  onBack,
  onError,
}: {
  value: Editor
  onChange: (v: Editor) => void
  taxonomy: Vocabulary
  tags: Tag[]
  busy: boolean
  onSave: () => void
  onBack: () => void
  onError: (e: string) => void
}) {
  const formId = useId()
  const [reading, setReading] = useState(false)
  const invalid = value.unsupported || invalidFields(value.fields, taxonomy, tags)
  return (
    <form
      id={formId}
      className="attribute-form template-editor"
      onSubmit={(e) => {
        e.preventDefault()
        if (!busy && !reading && !invalid && value.name.trim()) onSave()
      }}
    >
      <header className="template-view-heading">
        <h3 tabIndex={-1} data-template-heading>
          {value.id ? '编辑模板' : '另存为模板'}
        </h3>
        <p className="form-hint">草稿自动保留在本浏览器；点击保存才更新模板。</p>
      </header>
      <fieldset className="plain-fieldset" disabled={busy || reading}>
        <label>
          模板名称
          <input
            required
            maxLength={60}
            value={value.name}
            onChange={(e) => onChange({ ...value, name: e.target.value })}
            placeholder="例如：日常通勤"
          />
        </label>
        <p className="template-counter">{value.name.length} / 60 字</p>
        {invalid && (
          <div role="alert" className="notice">
            <p>
              {value.unsupported
                ? '此模板的旧字段无法直接编辑。可明确改用下方当前条件并保存修正。'
                : '存在失效标签或不支持的取值，请移除后保存。'}
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                onChange({
                  ...value,
                  unsupported: false,
                  fields: repairFields(value.fields, taxonomy, tags),
                })
              }
            >
              {value.unsupported ? '使用下方条件修正模板' : '移除失效条件'}
            </Button>
          </div>
        )}
        <TemplateFields
          value={value.fields}
          onChange={(fields) => onChange({ ...value, fields })}
          taxonomy={taxonomy}
          tags={tags}
        />
        <p className="form-hint">
          仅保存以上五类条件，不包含城市、天气、日期、季节和锁定。草稿保留在本浏览器。
        </p>
        {value.id && (
          <Button
            type="button"
            variant="outline"
            onClick={async () => {
              setReading(true)
              try {
                const latest = await getTemplate(value.id!)
                onChange({ ...value, version: latest.version })
                onError('已读取最新版本并保留输入；请核对后再次保存，将覆盖该版本。')
              } catch (e) {
                onError(e instanceof Error ? e.message : '读取失败')
              } finally {
                setReading(false)
              }
            }}
          >
            读取最新版本，保留输入
          </Button>
        )}
      </fieldset>
      <SheetFooter>
        <div className="template-actions">
          <p className="form-hint">
            {invalid
              ? '请先修正失效条件。'
              : !value.name.trim()
                ? '填写名称后即可保存。'
                : '仅保存模板，本次搭配条件保持。'}
          </p>
          <div className="template-action-buttons">
            <Button type="button" variant="outline" disabled={busy || reading} onClick={onBack}>
              返回列表，保留草稿
            </Button>
            <Button
              type="submit"
              form={formId}
              disabled={busy || reading || !!invalid || !value.name.trim()}
            >
              {busy ? '正在保存…' : '保存模板'}
            </Button>
          </div>
        </div>
      </SheetFooter>
    </form>
  )
}
