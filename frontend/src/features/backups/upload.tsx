import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { z } from 'zod'
import { Button } from '../../components/ui/button'
import { api } from '../../lib/http'
import { operationId } from '../../lib/id'
import { restoreSchema } from './api'

const key = 'wardrobe.backups.upload'
const pendingSchema = z.object({ key: z.string(), name: z.string(), size: z.number() })
function load() {
  try {
    return pendingSchema.parse(JSON.parse(localStorage.getItem(key) ?? 'null'))
  } catch {
    return null
  }
}
export function RestoreUpload({
  onUploaded,
  disabled = false,
}: {
  onUploaded: (id: string) => void
  disabled?: boolean
}) {
  const [fileError, setFileError] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [pending, setPending] = useState(load)
  const mutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('请选择备份文件')
      const operation = pending ?? { key: operationId(), name: file.name, size: file.size }
      localStorage.setItem(key, JSON.stringify(operation))
      setPending(operation)
      const form = new FormData()
      form.append('file', file)
      const result = await api('/restores/validate', restoreSchema, {
        method: 'POST',
        headers: { 'Idempotency-Key': operation.key },
        body: form,
      })
      localStorage.removeItem(key)
      setPending(null)
      onUploaded(result.restore_id)
    },
  })
  const mismatch = pending && file && (pending.name !== file.name || pending.size !== file.size)
  return (
    <div className="attribute-form">
      <h3>选择备份文件</h3>
      <p>只接受本应用当前版本的 ZIP 备份。验证不覆盖数据；最多 2 GiB。</p>
      <label>
        备份文件
        <input
          type="file"
          accept=".zip"
          disabled={mutation.isPending || disabled}
          onChange={(e) => {
            const next = e.target.files?.[0] ?? null
            const invalid =
              next && (!next.name.toLowerCase().endsWith('.zip') || next.size > 2 * 1024 ** 3)
            setFileError(invalid ? '请选择不超过 2 GiB 的 ZIP 备份文件。' : '')
            setFile(invalid ? null : next)
          }}
        />
      </label>
      {fileError && (
        <p role="alert" className="error">
          {fileError}
        </p>
      )}
      {file && (
        <p className="muted">
          已选择：{file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB
        </p>
      )}
      {pending && <p>上次上传尚未确认：{pending.name}。刷新后请重新选择同一文件，再重发原操作。</p>}
      {mismatch && <p role="alert">所选文件与待发操作不匹配。请重新选择，或放弃待发操作。</p>}
      {mutation.error && (
        <p role="alert" className="error">
          {mutation.error.message}
        </p>
      )}
      <Button
        disabled={!file || !!mismatch || mutation.isPending || disabled}
        onClick={() => mutation.mutate()}
      >
        {mutation.isPending ? '正在上传…' : pending ? '重发同一验证上传' : '上传并验证'}
      </Button>
      {pending && (
        <Button
          variant="outline"
          disabled={mutation.isPending || disabled}
          onClick={() => {
            localStorage.removeItem(key)
            setPending(null)
            mutation.reset()
          }}
        >
          放弃待发上传
        </Button>
      )}
    </div>
  )
}
