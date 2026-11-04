import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BookmarkPlus } from 'lucide-react'
import { Sheet } from '../../../components/ui/sheet'
import { waitForSheetCleanup } from '../../../components/ui/sheet-history'
import { Button } from '../../../components/ui/button'
import type { Requirements } from '../api'
import {
  listTemplates,
  getTemplate,
  fieldsSchema,
  pickFields,
  pendingOperation,
  sendOperation,
  forgetOperation,
  operation,
  type Template,
  type Operation,
} from './api'
import { type Tag, type Vocabulary } from './fields'
import { TemplateEditor, readEditor, storeEditor, editTemplate, type Editor } from './editor'
import { TemplateDetail } from './detail'
import { TemplateList } from './list'
import './templates.css'

export function TemplateControl({
  values,
  onApply,
  taxonomy,
  tags,
  disabled,
  context,
}: {
  values: Requirements
  onApply: (r: Requirements) => void
  taxonomy: Vocabulary
  tags: Tag[]
  disabled: boolean
  context: string
}) {
  const [open, setOpen] = useState(false)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [selected, setSelected] = useState<Template | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [pending, setPending] = useState(pendingOperation)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [notice, setNotice] = useState('')
  const [search, setSearch] = useState('')
  const panel = useRef<HTMLDivElement>(null)
  const applied = useRef(false)
  const feedback = useRef<HTMLParagraphElement>(null)
  const lastViewed = useRef<string | null>(null)
  const cache = useQueryClient()
  const query = useQuery({
    queryKey: ['condition-templates'],
    queryFn: listTemplates,
    enabled: open,
  })
  const stage = pending
    ? 'pending'
    : editor
      ? 'editor'
      : selected
        ? deleting
          ? 'delete'
          : 'detail'
        : 'list'
  useEffect(() => {
    if (!open || busy) return
    let frame = requestAnimationFrame(() => {
      // Base UI restores removed-control focus on the next frame; hand off after it.
      frame = requestAnimationFrame(() => {
        const item =
          stage === 'list' && lastViewed.current
            ? panel.current?.querySelector<HTMLElement>(
                `[data-template-id="${lastViewed.current}"]`,
              )
            : null
        const target = item ?? panel.current?.querySelector<HTMLElement>('[data-template-heading]')
        target?.focus()
      })
    })
    return () => cancelAnimationFrame(frame)
  }, [open, stage, busy])
  const changeEditor = (v: Editor | null) => {
    storeEditor(v)
    setEditor(v)
  }
  const backToList = () => {
    setEditor(null)
    setSelected(null)
    setDeleting(false)
    setMessage('')
  }
  async function write(op: Operation) {
    setBusy(true)
    setMessage('')
    try {
      await sendOperation(op)
      setPending(null)
      // Deleting a different template must never discard an unrelated local editing draft.
      if (op.method !== 'DELETE') changeEditor(null)
      setSelected(null)
      setDeleting(false)
      setSearch('')
      setMessage(op.method === 'DELETE' ? '模板已删除，已有搭配和草稿保持。' : '模板已保存。')
      await cache.invalidateQueries({ queryKey: ['condition-templates'] })
    } catch (e) {
      setPending(pendingOperation())
      setMessage(e instanceof Error ? e.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }
  async function choose(t: Template) {
    setBusy(true)
    setMessage('')
    try {
      setSelected(await getTemplate(t.id))
      lastViewed.current = t.id
      setDeleting(false)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '读取失败')
    } finally {
      setBusy(false)
    }
  }
  async function apply() {
    if (!selected) return
    const fields = fieldsSchema.safeParse(selected.conditions)
    if (!fields.success) return
    setBusy(true)
    try {
      const latest = await getTemplate(selected.id)
      if (latest.version !== selected.version || latest.issues.length) {
        setSelected(latest)
        setMessage('模板已变化，请重新核对后选用。')
        return
      }
      onApply({ ...values, ...fields.data })
      setNotice(`已选用“${selected.name}”，请核对天气后再生成。`)
      applied.current = true
      setSelected(null)
      setOpen(false)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '读取失败')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="template-entry">
      <Sheet
        title="常用条件模板"
        open={open}
        finalFocus={() => {
          if (applied.current) {
            applied.current = false
            void waitForSheetCleanup().then(() => feedback.current?.focus())
            return false
          }
          return true
        }}
        onOpenChange={(next) => {
          if (!busy) {
            setOpen(next)
            if (next) setPending(pendingOperation())
          }
        }}
        trigger={
          <Button variant="outline" disabled={disabled}>
            <BookmarkPlus size={18} aria-hidden="true" />
            条件模板
          </Button>
        }
      >
        <div className="template-panel" ref={panel} aria-busy={busy}>
          {stage === 'list' && (
            <p className="form-hint">把常用条件存下来，下次选用后核对天气再生成。</p>
          )}
          {message && (
            <p role="status" className="notice">
              {message}
            </p>
          )}
          {busy && (
            <p role="status" className="template-busy">
              正在处理，请稍候…
            </p>
          )}
          {pending ? (
            <section className="template-draft">
              <h3 tabIndex={-1} data-template-heading>
                确认上次模板操作
              </h3>
              <p>上次操作结果尚未确认。刷新不会自动重发，重试会沿用原操作。</p>
              <div className="template-recovery-actions">
                <Button disabled={busy} onClick={() => void write(pending)}>
                  重发原模板操作
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true)
                    try {
                      await query.refetch({ throwOnError: true })
                      forgetOperation()
                      setPending(null)
                      setEditor(null)
                      setSelected(null)
                      setDeleting(false)
                      setMessage('已读取列表。请先核对上次操作是否生效，再决定编辑。')
                    } catch (e) {
                      setMessage(e instanceof Error ? e.message : '读取失败')
                    } finally {
                      setBusy(false)
                    }
                  }}
                >
                  读取列表并结束原操作恢复
                </Button>
              </div>
            </section>
          ) : editor ? (
            <TemplateEditor
              value={editor}
              onChange={changeEditor}
              taxonomy={taxonomy}
              tags={tags}
              busy={busy}
              onError={setMessage}
              onBack={backToList}
              onSave={() =>
                void write(
                  operation(editor.id ? 'PATCH' : 'POST', editor.id, {
                    name: editor.name.trim(),
                    conditions: editor.fields,
                    ...(editor.id ? { expected_version: editor.version } : {}),
                  }),
                )
              }
            />
          ) : selected ? (
            <TemplateDetail
              template={selected}
              current={pickFields(values)}
              taxonomy={taxonomy}
              tags={tags}
              context={context}
              busy={busy}
              deleting={deleting}
              hasDraft={!!readEditor()}
              onApply={() => void apply()}
              onEdit={() => {
                setMessage('')
                changeEditor(editTemplate(selected, pickFields(values)))
              }}
              onDelete={() => setDeleting(true)}
              onCancelDelete={() => setDeleting(false)}
              onConfirmDelete={() =>
                void write(operation('DELETE', selected.id, { expected_version: selected.version }))
              }
              onBack={backToList}
            />
          ) : (
            <TemplateList
              rows={query.data}
              search={search}
              onSearch={setSearch}
              draft={readEditor()}
              busy={busy}
              loading={query.isPending}
              error={query.isError ? query.error.message : null}
              taxonomy={taxonomy}
              onRetry={() => void query.refetch()}
              onChoose={(t) => void choose(t)}
              onResume={() => {
                setMessage('')
                setEditor(readEditor())
              }}
              onDiscard={() => {
                changeEditor(null)
                setMessage('已放弃模板编辑草稿。')
              }}
              onCreate={() => {
                setMessage('')
                changeEditor({
                  id: null,
                  version: null,
                  name: '',
                  fields: pickFields(values),
                  unsupported: false,
                })
              }}
            />
          )}
        </div>
      </Sheet>
      {notice && (
        <p role="status" tabIndex={-1} ref={feedback} className="template-applied">
          {notice}
        </p>
      )}
    </div>
  )
}
