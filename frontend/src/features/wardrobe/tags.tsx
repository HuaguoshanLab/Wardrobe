import { useEffect, useState } from 'react'
import { Tags as TagsIcon } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/http'
import { Button } from '../../components/ui/button'
import { Sheet } from '../../components/ui/sheet'
import { getTags, tagSchema } from './api'

type Tag = { id: string; name: string; version: number }
export function Tags() {
  const [discard, setDiscard] = useState(false)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [selected, setSelected] = useState<Tag | null>(null)
  const [mode, setMode] = useState<'list' | 'rename' | 'delete'>('list')
  const client = useQueryClient()
  const tags = useQuery({ queryKey: ['tags'], queryFn: getTags })
  const mutation = useMutation({
    mutationFn: async () => {
      if (mode === 'delete' && selected) {
        const response = await fetch(`/api/v1/tags/${selected.id}`, {
          method: 'DELETE',
          headers: { 'If-Match': String(selected.version) },
        })
        if (!response.ok) throw new Error('删除失败，标签可能已被更新。请返回列表并重新读取。')
      } else {
        await api(selected ? `/tags/${selected.id}` : '/tags', tagSchema, {
          method: selected ? 'PATCH' : 'POST',
          body: JSON.stringify({
            name: name.trim(),
            ...(selected ? { expected_version: selected.version } : {}),
          }),
        })
      }
    },
    onSuccess: () => {
      setName('')
      setSelected(null)
      setMode('list')
      void client.invalidateQueries({ queryKey: ['tags'] })
      void client.invalidateQueries({ queryKey: ['garments'] })
      void client.invalidateQueries({ queryKey: ['garment'] })
    },
  })
  const reset = () => {
    setSelected(null)
    setName('')
    setMode('list')
    mutation.reset()
  }
  const dirty = mode !== 'delete' && name !== (selected?.name ?? '')
  useEffect(() => {
    if (!open || !dirty) return
    const prevent = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', prevent)
    return () => window.removeEventListener('beforeunload', prevent)
  }, [open, dirty])
  return (
    <>
      <Sheet
        title={mode === 'rename' ? '修改标签名称' : mode === 'delete' ? '删除标签' : '管理标签'}
        open={open}
        onOpenChange={(value) => {
          if (!mutation.isPending) {
            if (!value && dirty) {
              setDiscard(true)
              return
            }
            setOpen(value)
            if (!value) reset()
          }
        }}
        trigger={
          <button className="wardrobe-tag-trigger" aria-label="管理标签" title="管理标签">
            <TagsIcon size={18} aria-hidden="true" />
          </button>
        }
      >
        <div className="tag-manager">
          {mode === 'delete' ? (
            <>
              <h3>删除「{selected?.name}」？</h3>
              <p className="muted">该标签会从衣服上移除，衣服本身和历史穿搭不会被删除。</p>
              <div className="actions">
                <Button variant="outline" disabled={mutation.isPending} onClick={reset}>
                  取消
                </Button>
                <Button
                  className="button-danger"
                  disabled={mutation.isPending}
                  onClick={() => mutation.mutate()}
                >
                  {mutation.isPending ? '正在删除…' : '确认删除标签'}
                </Button>
              </div>
            </>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault()
                if (name.trim() && !mutation.isPending) mutation.mutate()
              }}
            >
              <label>
                {mode === 'rename' ? '标签名称' : '新标签'}
                <input
                  aria-label={mode === 'rename' ? '标签名称' : '新标签'}
                  value={name}
                  maxLength={40}
                  disabled={mutation.isPending}
                  onChange={(event) => {
                    setName(event.target.value)
                    mutation.reset()
                  }}
                  placeholder="例如：旅行常穿"
                />
              </label>
              <div className="actions">
                {mode === 'rename' && (
                  <Button
                    variant="outline"
                    disabled={mutation.isPending}
                    onClick={() => (dirty ? setDiscard(true) : reset())}
                  >
                    取消
                  </Button>
                )}
                <Button
                  type="submit"
                  disabled={!name.trim() || mutation.isPending || name.trim() === selected?.name}
                >
                  {mutation.isPending ? '正在保存…' : mode === 'rename' ? '保存名称' : '添加标签'}
                </Button>
              </div>
            </form>
          )}
          {mutation.error && (
            <p role="alert" className="error">
              {mutation.error.message}
              <Button
                variant="outline"
                onClick={() => {
                  reset()
                  void tags.refetch()
                }}
              >
                返回标签列表并刷新
              </Button>
            </p>
          )}
          {mode === 'list' && (
            <>
              <p className="muted">用自己的标签整理衣服，筛选时更容易找到。</p>
              {tags.isPending && <p role="status">正在读取标签…</p>}
              {tags.error && (
                <p role="alert">
                  标签读取失败。
                  <Button variant="outline" onClick={() => void tags.refetch()}>
                    重新读取标签
                  </Button>
                </p>
              )}
              {tags.data?.length === 0 && <p className="tag-empty">还没有标签，添加第一个吧。</p>}
              <div className="tag-manager-list">
                {tags.data?.map((tag) => (
                  <div key={tag.id}>
                    <span>{tag.name}</span>
                    <button
                      disabled={mutation.isPending || dirty}
                      onClick={() => {
                        setSelected(tag)
                        setName(tag.name)
                        setMode('rename')
                        mutation.reset()
                      }}
                      aria-label={`重命名${tag.name}`}
                    >
                      改名
                    </button>
                    <button
                      disabled={mutation.isPending || dirty}
                      onClick={() => {
                        setSelected(tag)
                        setMode('delete')
                        mutation.reset()
                      }}
                      aria-label={`删除标签${tag.name}`}
                    >
                      删除
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </Sheet>
      <Sheet
        title="放弃未保存的标签？"
        trigger={<span hidden />}
        open={discard}
        onOpenChange={setDiscard}
      >
        <p>标签名称尚未保存，放弃后将清除本次输入。</p>
        <div className="actions">
          <Button onClick={() => setDiscard(false)}>继续编辑</Button>
          <Button
            variant="outline"
            onClick={() => {
              setDiscard(false)
              setOpen(false)
              reset()
            }}
          >
            放弃修改
          </Button>
        </div>
      </Sheet>
    </>
  )
}
