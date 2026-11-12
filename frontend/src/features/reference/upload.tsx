import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { z } from 'zod'
import { api } from '../../lib/http'
import { operationId } from '../../lib/id'
import { Button } from '../../components/ui/button'
import { referenceSchema } from './api'

const storage = 'wardrobe.reference.upload'
const pendingSchema = z.object({ key: z.string(), signature: z.string() })
export function ReferenceUpload() {
  const navigate = useNavigate()
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState('')
  const [pending, setPending] = useState(() => {
    try {
      return pendingSchema.parse(JSON.parse(localStorage.getItem(storage) ?? 'null'))
    } catch {
      return null
    }
  })
  useEffect(() => {
    if (!file) return
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])
  const mutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('请选择一张参考图')
      if (file.size > 20 * 1024 * 1024) throw new Error('参考图不得超过20 MiB')
      const signature = JSON.stringify([file.name, file.size, file.lastModified])
      if (pending && pending.signature !== signature)
        throw new Error('请重新选择上次的同一文件以恢复上传')
      const op = pending ?? { signature, key: operationId() }
      localStorage.setItem(storage, JSON.stringify(op))
      setPending(op)
      const body = new FormData()
      body.append('file', file)
      return api('/references', referenceSchema, {
        method: 'POST',
        body,
        headers: { 'Idempotency-Key': op.key },
      })
    },
    onSuccess: (ref) => {
      localStorage.removeItem(storage)
      setPending(null)
      navigate(`/collections/reference/${ref.id}`)
    },
  })
  return (
    <section className="panel reference-upload">
      <h2>从喜欢的穿搭开始</h2>
      <p>
        一次一张，支持 JPG、PNG、WebP、HEIC，最多20 MiB。上传只保存参考，不会录入衣橱或自动调用AI。
      </p>
      <label>
        选择参考图
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          disabled={mutation.isPending}
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null)
            mutation.reset()
          }}
        />
      </label>
      {preview && file && <img className="reference-photo" src={preview} alt="待上传的参考图" />}
      {pending && (
        <p role="status">上次上传结果待确认。重新选择同一文件并点击上传，将复用原操作。</p>
      )}
      {mutation.error && (
        <p role="alert" className="error">
          {mutation.error.message}
        </p>
      )}
      <Button disabled={!file || mutation.isPending} onClick={() => mutation.mutate()}>
        {mutation.isPending ? '正在上传…' : pending ? '重发原上传' : '上传参考图'}
      </Button>
      {pending && (
        <Button
          variant="outline"
          disabled={mutation.isPending}
          onClick={() => {
            localStorage.removeItem(storage)
            setPending(null)
            mutation.reset()
          }}
        >
          结束上传恢复（请先核对下方列表）
        </Button>
      )}
    </section>
  )
}
