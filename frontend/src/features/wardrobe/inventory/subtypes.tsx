import { useEffect, useRef, useState } from 'react'
import { useBlocker, useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Button } from '../../../components/ui/button'
import { PageHeader } from '../../../components/ui/page-header'
import { Sheet, SheetFooter } from '../../../components/ui/sheet'
import { OperationNotice } from '../../../components/ui/operation-notice'
import { useOperation } from '../../../lib/use-operation'
import { getTaxonomy } from '../api'
import { getSubtypes } from '../lifecycle-api'
import { getImpact, getSuggestions, seasons, seasonSchema } from './api'
import './inventory.css'
import './editor.css'

type Edit = {
  id: string | null
  category: string
  name: string
  active: boolean
  version: number
  impact: Awaited<ReturnType<typeof getImpact>> | null
}

export function InventorySubtypesPage() {
  const [params] = useSearchParams()
  const season = seasonSchema.catch('spring').parse(params.get('season'))
  const taxonomy = useQuery({ queryKey: ['taxonomies'], queryFn: getTaxonomy })
  const subtypes = useQuery({ queryKey: ['garment-subtypes'], queryFn: getSubtypes })
  const suggestions = useQuery({ queryKey: ['subtype-suggestions'], queryFn: getSuggestions })
  const [category, setCategory] = useState('top')
  const [search, setSearch] = useState('')
  const [draft, setDraft] = useState<Edit | null>(null)
  const [dirty, setDirty] = useState(false)
  const [discard, setDiscard] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const focus = useRef<HTMLElement | null>(null)
  const operation = useOperation('inventory-subtypes', () => {
    setDraft(null)
    setDirty(false)
  })
  const blocked = dirty || operation.sending
  const blocker = useBlocker(blocked)
  useEffect(() => {
    if (!blocked) return
    const prevent = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', prevent)
    return () => window.removeEventListener('beforeunload', prevent)
  }, [blocked])
  const edit = async (id: string) => {
    focus.current = document.activeElement as HTMLElement
    setLoading(true)
    setError('')
    try {
      const impact = await getImpact(id)
      setDraft({ ...impact.subtype, impact })
      setDirty(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : '读取影响失败')
    } finally {
      setLoading(false)
    }
  }
  const change = (value: Edit) => {
    setDraft(value)
    setDirty(true)
  }
  return (
    <section className="inventory-page">
      <PageHeader
        title="管理衣物子类"
        backTo={`/wardrobe/inventory?season=${season}`}
        backLabel="返回盘点"
      />
      <p>子类让需求更具体，比如上装里的衬衫、T恤。改名保留原关联，停用不删除已有衣服或需求。</p>
      <div className="inventory-toolbar">
        <label>
          选择大类
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {Object.entries(taxonomy.data?.fields.category ?? { top: '上装' }).map(
              ([key, name]) => (
                <option key={key} value={key}>
                  {name}
                </option>
              ),
            )}
          </select>
        </label>
        <Button
          disabled={operation.busy || loading}
          onClick={() => {
            focus.current = document.activeElement as HTMLElement
            setDraft({ id: null, category, name: '', active: true, version: 1, impact: null })
            setDirty(false)
          }}
        >
          新增子类
        </Button>
      </div>
      <label className="inventory-search">
        查找子类
        <input
          type="search"
          placeholder="输入子类名称"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      {subtypes.isPending && <p role="status">正在读取子类…</p>}
      {(subtypes.error || taxonomy.error) && (
        <p role="alert">
          选项读取失败。
          <Button
            onClick={() => {
              void subtypes.refetch()
              void taxonomy.refetch()
            }}
          >
            重新读取
          </Button>
        </p>
      )}
      {loading && <p role="status">正在核对引用影响…</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {subtypes.data
        ?.filter(
          (s) =>
            s.category === category &&
            s.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
        )
        .map((s) => (
          <div className="panel inventory-subtype" key={s.id}>
            <span>
              <strong>{s.name}</strong>
              <small>{s.active ? '可供新归类使用' : '已停用 · 原关联保留'}</small>
            </span>
            <Button
              variant="outline"
              disabled={operation.busy || loading}
              onClick={() => void edit(s.id)}
            >
              管理{s.name}
            </Button>
          </div>
        ))}
      {subtypes.data && !subtypes.data.some((s) => s.category === category) && (
        <p className="panel">此大类还没有子类。新增时可选参考名称，也可以自己填写。</p>
      )}
      {search &&
        subtypes.data &&
        !subtypes.data.some(
          (s) =>
            s.category === category &&
            s.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
        ) && (
          <p role="status">
            没有匹配的子类。
            <Button variant="outline" onClick={() => setSearch('')}>
              清除搜索
            </Button>
          </p>
        )}
      <OperationNotice operation={operation} />
      <Sheet
        title={draft?.id ? '修改子类与引用影响' : '新增子类'}
        open={!!draft}
        finalFocus={focus}
        trigger={<button hidden type="button" />}
        onOpenChange={(open) => {
          if (!open) {
            if (dirty || operation.sending) setDiscard(true)
            else setDraft(null)
          }
        }}
      >
        {draft && (
          <form
            id="subtype-edit"
            className="inventory-form"
            onSubmit={(e) => {
              e.preventDefault()
              if (draft.id && draft.impact)
                operation.send(`/garment-subtypes/${draft.id}`, 'PATCH', {
                  expected_version: draft.version,
                  name: draft.name,
                  active: draft.active,
                  impact_token: draft.impact.token,
                })
              else
                operation.send('/garment-subtypes', 'POST', {
                  category: draft.category,
                  name: draft.name,
                })
            }}
          >
            <fieldset disabled={operation.busy || loading}>
              <p>所属大类：{taxonomy.data?.fields.category[draft.category] ?? draft.category}</p>
              <label>
                子类名称
                <input
                  value={draft.name}
                  onChange={(e) => change({ ...draft, name: e.target.value })}
                  required
                  maxLength={40}
                  list="subtype-name-suggestions"
                />
              </label>
              <datalist id="subtype-name-suggestions">
                {suggestions.data?.[draft.category]?.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
              {!draft.id && (
                <div className="inventory-suggestions">
                  <p className="muted">选个参考名称，或直接输入。不会自动给衣服归类。</p>
                  <div>
                    {suggestions.data?.[draft.category]?.map((name) => (
                      <Button
                        key={name}
                        variant="outline"
                        onClick={() => change({ ...draft, name })}
                      >
                        {name}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
              {draft.id && (
                <label className="inventory-checkbox">
                  <input
                    type="checkbox"
                    checked={draft.active}
                    onChange={(e) => change({ ...draft, active: e.target.checked })}
                  />
                  允许新的归类和需求引用
                </label>
              )}
              {draft.impact && (
                <section className="inventory-impact">
                  <h3>这次修改会影响</h3>
                  <p>
                    {draft.impact.owned_count} 件当前持有衣服，{draft.impact.garment_count}{' '}
                    份单品档案，{draft.impact.rows.length} 条需求。
                  </p>
                  {draft.impact.rows.map((r) => (
                    <p key={r.id}>
                      {seasons[r.season as keyof typeof seasons] ?? r.season}季 · {r.name}
                      {r.enabled ? '' : '（已停用）'}
                    </p>
                  ))}
                  <p>
                    改名会同步显示新名称，匹配仍使用同一个
                    ID。停用只阻止新增引用，现有统计规则继续有效。
                  </p>
                </section>
              )}
            </fieldset>
            <OperationNotice operation={operation} />
            {draft.id && (operation.error || operation.pending) && (
              <Button
                variant="outline"
                disabled={operation.sending || loading}
                onClick={async () => {
                  setLoading(true)
                  try {
                    const impact = await getImpact(draft.id!)
                    operation.discard()
                    setDraft({ ...draft, version: impact.subtype.version, impact })
                    setError('')
                  } catch (e) {
                    setError(e instanceof Error ? e.message : '读取失败')
                  } finally {
                    setLoading(false)
                  }
                }}
              >
                保留输入并重新核对影响
              </Button>
            )}
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <SheetFooter>
              <Button
                type="submit"
                form="subtype-edit"
                disabled={operation.busy || loading || !draft.name.trim()}
              >
                {operation.sending ? '正在保存…' : draft.id ? '确认影响并保存' : '创建子类'}
              </Button>
            </SheetFooter>
          </form>
        )}
      </Sheet>
      <Sheet
        title={operation.sending ? '正在保存，请稍候' : '放弃未保存的修改？'}
        open={discard || blocker.state === 'blocked'}
        trigger={<button hidden type="button" />}
        onOpenChange={(open) => {
          if (!open) {
            setDiscard(false)
            if (blocker.state === 'blocked') blocker.reset()
          }
        }}
      >
        <p>尚未保存的输入会被放弃；未确认请求仍保留原操作键。</p>
        <Button
          onClick={() => {
            setDiscard(false)
            if (blocker.state === 'blocked') blocker.reset()
          }}
        >
          继续编辑
        </Button>
        <Button
          variant="outline"
          disabled={operation.sending}
          onClick={() => {
            setDraft(null)
            setDirty(false)
            setDiscard(false)
            if (blocker.state === 'blocked') blocker.proceed()
          }}
        >
          放弃修改
        </Button>
      </Sheet>
    </section>
  )
}
