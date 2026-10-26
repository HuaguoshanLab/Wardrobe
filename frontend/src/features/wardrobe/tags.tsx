import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/http'
import { Button } from '../../components/ui/button'
import { getTags, tagSchema } from './api'

export function Tags() {
  const [name, setName] = useState('')
  const client = useQueryClient()
  const tags = useQuery({ queryKey: ['tags'], queryFn: getTags })
  const mutation = useMutation({
    mutationFn: () => api('/tags', tagSchema, { method: 'POST', body: JSON.stringify({ name }) }),
    onSuccess: () => {
      setName('')
      void client.invalidateQueries({ queryKey: ['tags'] })
    },
  })
  const rename = useMutation({
    mutationFn: ({ id, name, version }: { id: string; name: string; version: number }) =>
      api(`/tags/${id}`, tagSchema, {
        method: 'PATCH',
        body: JSON.stringify({ name, expected_version: version }),
      }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['tags'] }),
  })
  const remove = useMutation({
    mutationFn: async ({ id, version }: { id: string; version: number }) => {
      const response = await fetch(`/api/v1/tags/${id}`, {
        method: 'DELETE',
        headers: { 'If-Match': String(version) },
      })
      if (!response.ok) throw new Error('删除失败，请刷新后重试')
    },
    onSuccess: () => void client.invalidateQueries(),
  })
  return (
    <details className="panel tag-panel">
      <summary>管理自定义标签</summary>
      <form
        className="actions"
        onSubmit={(e) => {
          e.preventDefault()
          mutation.mutate()
        }}
      >
        <input
          aria-label="新标签"
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
          placeholder="例如：旅行常穿"
        />
        <Button disabled={!name.trim() || mutation.isPending}>添加标签</Button>
      </form>
      <div className="tag-list">
        {tags.data?.map((tag) => (
          <span key={tag.id}>
            {tag.name}
            <button
              onClick={() => {
                const value = window.prompt('修改标签名称', tag.name)
                if (value?.trim()) rename.mutate({ ...tag, name: value })
              }}
            >
              改名
            </button>
            <button
              onClick={() => {
                if (window.confirm(`删除标签“${tag.name}”？会从当前衣服移除。`)) remove.mutate(tag)
              }}
            >
              删除
            </button>
          </span>
        ))}
      </div>
      {(mutation.error || rename.error || remove.error) && (
        <p role="alert" className="error">
          {(mutation.error || rename.error || remove.error)?.message}
        </p>
      )}
    </details>
  )
}
