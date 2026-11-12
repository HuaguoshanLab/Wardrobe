import { useEffect, useRef, useState } from 'react'
import { Button } from '../../../components/ui/button'
import { fieldsSchema, type Template } from './api'
import { type Vocabulary } from './fields'
import type { Editor } from './editor'

export function TemplateList({
  rows,
  search,
  onSearch,
  draft,
  busy,
  loading,
  error,
  onRetry,
  onCreate,
  onResume,
  onDiscard,
  onChoose,
  taxonomy,
}: {
  rows: Template[] | undefined
  search: string
  onSearch: (s: string) => void
  draft: Editor | null
  busy: boolean
  loading: boolean
  error: string | null
  onRetry: () => void
  onCreate: () => void
  onResume: () => void
  onDiscard: () => void
  onChoose: (t: Template) => void
  taxonomy: Vocabulary
}) {
  const searchInput = useRef<HTMLInputElement>(null)
  const discardButton = useRef<HTMLButtonElement>(null)
  const cancelDiscard = useRef<HTMLButtonElement>(null)
  const [discarding, setDiscarding] = useState(false)
  useEffect(() => {
    if (discarding) cancelDiscard.current?.focus()
  }, [discarding])
  const matches = rows?.filter((t) =>
    t.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  )
  return (
    <div className="template-list">
      <div className="template-list-heading">
        <h3 tabIndex={-1} data-template-heading>
          已保存的模板
        </h3>
        <span>{rows ? `${rows.length} / 100` : '读取中'}</span>
      </div>
      <Button disabled={busy || !!draft} onClick={onCreate}>
        将当前条件另存为模板
      </Button>
      {draft && (
        <section className="template-draft">
          <strong>有未保存的模板编辑草稿</strong>
          <p>{draft.name || '未命名模板'} · 已保留在本浏览器</p>
          {discarding ? (
            <div className="template-discard" role="group" aria-label="放弃草稿确认">
              <p>放弃后无法找回这些编辑；已保存的模板保持。</p>
              <div className="template-management">
                <Button
                  ref={cancelDiscard}
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setDiscarding(false)
                    requestAnimationFrame(() =>
                      requestAnimationFrame(() => discardButton.current?.focus()),
                    )
                  }}
                >
                  保留草稿
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => {
                    setDiscarding(false)
                    onDiscard()
                    requestAnimationFrame(() =>
                      requestAnimationFrame(() => searchInput.current?.focus()),
                    )
                  }}
                >
                  确认放弃草稿
                </Button>
              </div>
            </div>
          ) : (
            <div className="template-management">
              <Button variant="outline" disabled={busy} onClick={onResume}>
                继续编辑草稿
              </Button>
              <Button
                ref={discardButton}
                variant="outline"
                className="template-quiet"
                disabled={busy}
                onClick={() => setDiscarding(true)}
              >
                放弃模板编辑草稿
              </Button>
            </div>
          )}
        </section>
      )}
      <div className="template-search">
        <label>
          搜索模板
          <input
            ref={searchInput}
            type="search"
            value={search}
            placeholder="输入模板名称"
            onChange={(e) => onSearch(e.target.value)}
          />
        </label>
        {search && (
          <Button
            variant="outline"
            className="template-quiet"
            onClick={() => {
              onSearch('')
              searchInput.current?.focus()
            }}
          >
            清空搜索
          </Button>
        )}
      </div>
      {search && rows && (
        <p className="form-hint" role="status">
          找到 {matches?.length} 个模板
        </p>
      )}
      {loading && <p role="status">正在读取模板…</p>}
      {error && (
        <div role="alert" className="notice">
          <p>{error}</p>
          <Button variant="outline" onClick={onRetry}>
            重新读取模板
          </Button>
        </div>
      )}
      {matches?.map((t) => {
        const fields = fieldsSchema.safeParse(t.conditions)
        const summary = fields.success
          ? [
              fields.data.occasion_codes.map((v) => taxonomy.occasion_codes?.[v] ?? v).join('、') ||
                '场合不限',
              { normal: '正常搭配', avoid_recent: '避开近期组合', less_worn: '优先近期少穿' }[
                fields.data.rotation_mode
              ],
            ].join(' · ')
          : '条件需要修正'
        return (
          <Button
            key={t.id}
            variant="outline"
            className="template-card"
            data-template-id={t.id}
            aria-label={`${t.name} ${t.issues.length ? '需要修正' : '查看与选用'}`}
            disabled={busy}
            onClick={() => onChoose(t)}
          >
            <span className="template-card-title">{t.name}</span>
            <span className="template-card-summary">{summary}</span>
            <span className="template-card-action">
              {t.issues.length ? '需要修正' : '查看与选用'} <span aria-hidden="true">→</span>
            </span>
          </Button>
        )
      })}
      {!loading && !error && matches?.length === 0 && (
        <div className="template-empty">
          <p>
            {search ? '没有匹配模板，试试其他关键词。' : '还没有模板。可先将当前条件保存下来。'}
          </p>
          <span>场合、风格、标签、补充要求和轮换模式可以一起复用。</span>
        </div>
      )}
    </div>
  )
}
