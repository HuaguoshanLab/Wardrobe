import { useEffect, useState } from 'react'
import { useBlocker } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { getTaxonomy } from '../wardrobe'
import { Button } from '../../components/ui/button'
import { Sheet } from '../../components/ui/sheet'
import { clueSchema, type Clue, type Reference } from './api'

const draftSchema = z.object({ version: z.int(), clues: z.array(clueSchema) })
export function ReferenceEditor({
  value,
  busy,
  onSave,
  onDirty,
}: {
  value: Reference
  busy: boolean
  onDirty: (dirty: boolean) => void
  onSave: (clues: Clue[], version: number) => void
}) {
  const key = `wardrobe.reference.draft:${value.id}`
  const [draft, setDraft] = useState(() => {
    try {
      return draftSchema.parse(JSON.parse(localStorage.getItem(key) ?? 'null'))
    } catch {
      return { version: value.version, clues: value.clues }
    }
  })
  const [dirty, setDirty] = useState(() => !!localStorage.getItem(key))
  useEffect(() => onDirty(dirty), [dirty, onDirty])
  const taxonomy = useQuery({ queryKey: ['taxonomies'], queryFn: getTaxonomy })
  const blocker = useBlocker(dirty)
  useEffect(() => {
    if (!dirty) return
    const handler = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])
  function edit(clues: Clue[]) {
    const next = { ...draft, clues }
    setDraft(next)
    setDirty(true)
    localStorage.setItem(key, JSON.stringify(next))
  }
  function change(index: number, fields: Partial<Clue>) {
    edit(draft.clues.map((c, i) => (i === index ? { ...c, ...fields } : c)))
  }
  return (
    <section className="panel reference-editor">
      <h2>核对参考线索</h2>
      <p>删掉看不清或不想参考的部分，再确认。未选择的颜色、风格与层次保持未知。</p>
      {value.analysis?.subject !== 'single' && (
        <p className="notice">主体不明确，请手工添加你想参考的线索，或裁剪后重新上传。</p>
      )}
      {taxonomy.error && (
        <p role="alert">
          词表读取失败。<Button onClick={() => void taxonomy.refetch()}>重新读取</Button>
        </p>
      )}
      {draft.version !== value.version && (
        <p role="alert">
          服务端记录已变化，草稿仍保留。
          <Button
            disabled={busy}
            onClick={() => {
              setDraft({ ...draft, version: value.version })
              localStorage.setItem(key, JSON.stringify({ ...draft, version: value.version }))
            }}
          >
            保留线索并采用最新版本
          </Button>
        </p>
      )}
      {draft.clues.map((clue, index) => (
        <fieldset key={index} disabled={busy} className="reference-clue">
          <legend>参考单品 {index + 1}</legend>
          <label>
            品类
            <select
              value={clue.category}
              onChange={(e) =>
                change(index, { category: clueSchema.shape.category.parse(e.target.value) })
              }
            >
              {Object.entries(taxonomy.data?.fields.category ?? {}).map(([code, name]) => (
                <option value={code} key={code}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          {(['color_codes', 'style_codes'] as const).map((field) => (
            <fieldset key={field} className="wardrobe-choice-group">
              <legend>{field === 'color_codes' ? '颜色（最多5项）' : '风格（最多3项）'}</legend>
              <div className="wardrobe-chips">
                {Object.entries(taxonomy.data?.fields[field] ?? {}).map(([code, name]) => (
                  <button
                    type="button"
                    key={code}
                    aria-pressed={clue[field].includes(code)}
                    disabled={
                      !clue[field].includes(code) &&
                      clue[field].length >= (field === 'color_codes' ? 5 : 3)
                    }
                    onClick={() =>
                      change(index, {
                        [field]: clue[field].includes(code)
                          ? clue[field].filter((v) => v !== code)
                          : [...clue[field], code],
                      })
                    }
                  >
                    {name}
                  </button>
                ))}
              </div>
            </fieldset>
          ))}
          <label>
            层次
            <select
              value={clue.layer}
              onChange={(e) =>
                change(index, { layer: clueSchema.shape.layer.parse(e.target.value) })
              }
            >
              {Object.entries({
                unknown: '未知',
                inner: '内层',
                outer: '外层',
                single: '单层',
              }).map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <Button variant="outline" onClick={() => edit(draft.clues.filter((_, i) => i !== index))}>
            移除参考单品 {index + 1}
          </Button>
        </fieldset>
      ))}
      <div className="actions">
        <Button
          variant="outline"
          disabled={busy || draft.clues.length >= 12 || !taxonomy.data}
          onClick={() =>
            edit([
              ...draft.clues,
              { category: 'top', color_codes: [], style_codes: [], layer: 'unknown' },
            ])
          }
        >
          添加参考单品
        </Button>
        <Button
          disabled={busy || !taxonomy.data || draft.version !== value.version}
          onClick={() => {
            onSave(draft.clues, draft.version)
          }}
        >
          确认这些线索
        </Button>
      </div>
      <Sheet
        title="离开参考线索编辑？"
        trigger={<span hidden />}
        open={blocker.state === 'blocked'}
        onOpenChange={(open) => {
          if (!open && blocker.state === 'blocked') blocker.reset()
        }}
      >
        <p>草稿保留在当前浏览器，不会自动提交或调用AI。</p>
        <div className="actions">
          <Button onClick={() => blocker.state === 'blocked' && blocker.reset()}>继续编辑</Button>
          <Button
            variant="outline"
            onClick={() => blocker.state === 'blocked' && blocker.proceed()}
          >
            保留草稿并离开
          </Button>
        </div>
      </Sheet>
    </section>
  )
}
