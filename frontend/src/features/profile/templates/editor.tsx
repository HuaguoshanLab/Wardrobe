import { useEffect, useId, useRef, useState } from 'react'
import { z } from 'zod'
import { SheetFooter } from '../../../components/ui/sheet'
import { Button } from '../../../components/ui/button'
import { fieldsSchema, getTemplate, type Fields, type Template } from './api'
import {
  FieldsPreview,
  TemplateFields,
  invalidFields,
  repairFields,
  type Tag,
  type Vocabulary,
} from './fields'
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
  const [readMessage, setReadMessage] = useState('')
  const [latest, setLatest] = useState<Template | null>(null)
  const comparison = useRef<HTMLHeadingElement>(null)
  const readButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (latest) {
      comparison.current?.focus()
      comparison.current?.scrollIntoView?.({ block: 'start', behavior: 'instant' })
    }
  }, [latest])
  const invalid = value.unsupported || invalidFields(value.fields, taxonomy, tags)
  return (
    <form
      id={formId}
      className="attribute-form template-editor"
      onSubmit={(e) => {
        e.preventDefault()
        if (!busy && !reading && !latest && !invalid && value.name.trim()) onSave()
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
            ref={readButton}
            type="button"
            variant="outline"
            onClick={async () => {
              setReading(true)
              setReadMessage('')
              onError('')
              try {
                const row = await getTemplate(value.id!)
                if (row.version === value.version) {
                  setLatest(null)
                  setReadMessage('已是最新版本，你的编辑保持。')
                } else {
                  setLatest(row)
                }
              } catch (e) {
                setReadMessage(e instanceof Error ? e.message : '读取失败')
              } finally {
                setReading(false)
              }
            }}
          >
            {reading ? '正在读取最新版本…' : '读取最新版本，保留输入'}
          </Button>
        )}
        {readMessage && (
          <p className="notice" role="status">
            {readMessage}
          </p>
        )}
      </fieldset>
      {latest && (
        <section className="template-version-review">
          <h4 ref={comparison} tabIndex={-1}>
            核对其他地方保存的修改
          </h4>
          <p>你的编辑保持在上方。继续保存会覆盖下面的最新内容。</p>
          <p className="template-latest-name">最新名称：{latest.name}</p>
          {fieldsSchema.safeParse(latest.conditions).success ? (
            <FieldsPreview
              value={fieldsSchema.parse(latest.conditions)}
              taxonomy={taxonomy}
              tags={tags}
            />
          ) : (
            <p role="alert">最新模板包含不支持的字段。选择覆盖后将用上方条件完整替换。</p>
          )}
          {latest.issues.map((issue) => (
            <p role="alert" key={issue}>
              {issue}
            </p>
          ))}
          <div className="template-management">
            <Button
              type="button"
              variant="outline"
              disabled={busy || reading}
              onClick={() => {
                setLatest(null)
                requestAnimationFrame(() =>
                  requestAnimationFrame(() => readButton.current?.focus()),
                )
              }}
            >
              暂不覆盖
            </Button>
            <Button
              type="button"
              disabled={busy || reading}
              onClick={() => {
                onChange({ ...value, version: latest.version })
                setLatest(null)
                setReadMessage('已核对最新内容；点击保存模板后才会覆盖。')
                requestAnimationFrame(() =>
                  requestAnimationFrame(() => readButton.current?.focus()),
                )
              }}
            >
              保留我的输入，继续保存
            </Button>
          </div>
        </section>
      )}
      <SheetFooter>
        <div className="template-actions">
          <p className="form-hint">
            {latest
              ? '先核对最新内容，再决定是否覆盖。'
              : invalid
                ? '请先修正失效条件。'
                : !value.name.trim()
                  ? '填写名称后即可保存。'
                  : '仅保存模板，本次搭配条件保持。'}
          </p>
          <div className="template-action-buttons">
            <Button
              type="button"
              variant="outline"
              aria-label="返回列表，保留草稿"
              disabled={busy || reading}
              onClick={onBack}
            >
              返回列表
            </Button>
            <Button
              type="submit"
              form={formId}
              disabled={busy || reading || !!latest || !!invalid || !value.name.trim()}
            >
              {busy ? '正在保存…' : '保存模板'}
            </Button>
          </div>
        </div>
      </SheetFooter>
    </form>
  )
}
