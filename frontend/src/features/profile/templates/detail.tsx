import { Button } from '../../../components/ui/button'
import { SheetFooter } from '../../../components/ui/sheet'
import { fieldsSchema, type Fields, type Template } from './api'
import { FieldsPreview, invalidFields, type Tag, type Vocabulary } from './fields'

export function TemplateDetail({
  template,
  current,
  taxonomy,
  tags,
  context,
  busy,
  deleting,
  hasDraft,
  onApply,
  onEdit,
  onDelete,
  onCancelDelete,
  onConfirmDelete,
  onBack,
}: {
  template: Template
  current: Fields
  taxonomy: Vocabulary
  tags: Tag[]
  context: string
  busy: boolean
  deleting: boolean
  hasDraft: boolean
  onApply: () => void
  onEdit: () => void
  onDelete: () => void
  onCancelDelete: () => void
  onConfirmDelete: () => void
  onBack: () => void
}) {
  const fields = fieldsSchema.safeParse(template.conditions)
  const invalid =
    template.issues.length > 0 || !fields.success || invalidFields(fields.data, taxonomy, tags)
  return (
    <div className="template-detail">
      <Button variant="outline" className="template-quiet" disabled={busy} onClick={onBack}>
        返回模板列表
      </Button>
      <header className="template-view-heading">
        <p className="template-eyebrow">{deleting ? '删除确认' : '选用前核对'}</p>
        <h3 tabIndex={-1} data-template-heading>
          {template.name}
        </h3>
      </header>
      {template.issues.map((issue) => (
        <p role="alert" className="notice" key={issue}>
          {issue}
        </p>
      ))}
      {deleting ? (
        <div className="template-warning">
          <strong>确认删除这个模板？</strong>
          <p>删除后将从模板列表移除。历史搭配、已填条件和未保存草稿保持。</p>
        </div>
      ) : (
        <>
          <section className="template-context">
            <h4>本次安排保持</h4>
            <p>{context}保持；天气请按本次日期与城市重新核对。</p>
          </section>
          <p className="form-hint">以下五类条件将替换当前草稿，空值也会替换；不会拼接旧说明。</p>
        </>
      )}
      {fields.success ? (
        <FieldsPreview value={fields.data} taxonomy={taxonomy} tags={tags} />
      ) : (
        <p role="alert">模板字段不受支持，请编辑修正。</p>
      )}
      {!deleting && (
        <>
          <details className="template-comparison">
            <summary>查看将被替换的当前条件</summary>
            <FieldsPreview value={current} taxonomy={taxonomy} tags={tags} />
          </details>
          {hasDraft && (
            <p className="form-hint">已有模板编辑草稿，请返回列表继续编辑或明确放弃。</p>
          )}
          <div className="template-management">
            <Button variant="outline" disabled={busy || hasDraft} onClick={onEdit}>
              编辑模板
            </Button>
            <Button variant="outline" className="template-quiet" disabled={busy} onClick={onDelete}>
              删除模板
            </Button>
          </div>
        </>
      )}
      <SheetFooter>
        <div className="template-actions">
          <p className="form-hint">
            {deleting
              ? '仅删除模板，已有搭配保持。'
              : invalid
                ? '请先修正模板中的失效条件。'
                : '选用后仍可修改，核对天气后再生成。'}
          </p>
          <div className="template-action-buttons">
            {deleting && (
              <Button variant="outline" disabled={busy} onClick={onCancelDelete}>
                取消删除
              </Button>
            )}
            <Button
              disabled={busy || (!deleting && !!invalid)}
              onClick={deleting ? onConfirmDelete : onApply}
            >
              {busy ? '正在处理…' : deleting ? '确认删除模板' : '确认替换当前条件'}
            </Button>
          </div>
        </div>
      </SheetFooter>
    </div>
  )
}
