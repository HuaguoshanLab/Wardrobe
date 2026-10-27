import { useState } from 'react'
import { useNavigate, Link } from 'react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Button } from '../../components/ui/button'
import { api } from '../../lib/http'
import { operationId } from '../../lib/id'
import { getCapabilities } from '../system/api'
import { acceptedSchema } from './api'

export function ImportPage() {
  const [kind, setKind] = useState<'photos' | 'excel'>('photos')
  const [files, setFiles] = useState<File[]>([])
  const [validation, setValidation] = useState('')
  const navigate = useNavigate()
  const capability = useQuery({ queryKey: ['capabilities'], queryFn: getCapabilities })
  const recognitionUnknown = capability.isPending || capability.isError || !capability.data
  const recent = localStorage.getItem('wardrobe.recentImport')
  const mutation = useMutation({
    mutationFn: async () => {
      if (kind === 'photos' && recognitionUnknown) {
        throw new Error('请先读取识别配置，再提交照片')
      }
      const signature = JSON.stringify({
        kind,
        files: files.map((f) => [f.name, f.size, f.lastModified]),
      })
      const stored = localStorage.getItem('wardrobe.upload')
      const previous = stored ? (JSON.parse(stored) as { signature: string; key: string }) : null
      const key = previous?.signature === signature ? previous.key : operationId()
      localStorage.setItem('wardrobe.upload', JSON.stringify({ signature, key }))
      const data = new FormData()
      files.forEach((file) => data.append(kind === 'photos' ? 'files' : 'file', file))
      return api(`/imports/${kind}`, acceptedSchema, {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: data,
      })
    },
    onSuccess: (result) => {
      localStorage.removeItem('wardrobe.upload')
      localStorage.setItem('wardrobe.recentImport', result.import_batch_id)
      navigate(`/imports/${result.import_batch_id}`)
    },
  })
  function choose(list: FileList | null) {
    const next = Array.from(list ?? [])
    setValidation('')
    mutation.reset()
    if (
      next.length > (kind === 'photos' ? 20 : 1) ||
      next.some((f) => f.size > (kind === 'photos' ? 20 : 50) * 1024 * 1024) ||
      next.reduce((n, f) => n + f.size, 0) > 200 * 1024 * 1024
    ) {
      setValidation('文件数量或大小超过限制，请重新选择')
      setFiles([])
      return
    }
    setFiles(next)
  }
  return (
    <>
      <Link to="/wardrobe" className="text-link">
        ← 返回衣橱
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">MAKE ROOM FOR YOUR STYLE</span>
          <h1>录入衣服</h1>
          <p>先预览、再确认。只有你确认的单品才会进入衣橱。</p>
        </div>
      </div>
      <div className="import-choices">
        {(['photos', 'excel'] as const).map((value) => (
          <button
            key={value}
            className={`panel import-choice ${kind === value ? 'selected' : ''}`}
            aria-pressed={kind === value}
            disabled={mutation.isPending}
            onClick={() => {
              setKind(value)
              setFiles([])
              setValidation('')
              mutation.reset()
            }}
          >
            <strong>{value === 'photos' ? '批量上传照片' : '导入 Excel'}</strong>
            <span>
              {value === 'photos'
                ? '每张一件 → 识别预填 → 逐行确认'
                : '图片与标签在同一文件 → 检查修改 → 逐行确认'}
            </span>
          </button>
        ))}
      </div>
      <section className="panel upload-panel">
        <h2>{kind === 'photos' ? '选择单品照片' : '选择模板文件'}</h2>
        {kind === 'photos' ? (
          <>
            <p>
              支持平铺或挂拍，鞋可一双合拍。JPEG、PNG、WebP、HEIC / HEIF，每次最多 20 张，单张 20
              MB，总计 200 MB。
            </p>
            <p className="notice">
              {capability.isPending
                ? '正在读取识别配置，请稍候。'
                : capability.isError
                  ? '识别配置读取失败，请重试后再上传照片。'
                  : capability.data?.recognition === 'fake'
                    ? 'Fake 识别只模拟填入“上装”，请核对品类。'
                    : capability.data?.recognition === 'configured'
                      ? '上传后将标准缩略图发送给千问预填属性，请核对后确认；未知属性可留空。'
                      : '真实识别未配置，可上传照片并手工填写品类。'}
              图片转换与去背景为本地真实处理。
            </p>
            {capability.isError && (
              <Button
                variant="outline"
                disabled={capability.isFetching}
                onClick={() => void capability.refetch()}
              >
                重试读取识别配置
              </Button>
            )}
          </>
        ) : (
          <>
            <p>
              使用 v1 模板，最多 100 行、50 MB。图片和品类必填，其他属性可留空，不调用 AI
              覆盖已有标签。
            </p>
            <a className="text-link" href="/api/v1/imports/template" download>
              下载 Excel 模板（含可替换示例）
            </a>
            <p>
              插入浮动嵌入图片，左上角放在对应行的图片列，调高行高让图片完整落在一行内。暂不支持“置于单元格”图片、公式或外链。
            </p>
          </>
        )}
        <input
          key={kind}
          aria-label={kind === 'photos' ? '上传照片' : '上传 Excel'}
          type="file"
          multiple={kind === 'photos'}
          accept={kind === 'photos' ? '.jpg,.jpeg,.png,.webp,.heic,.heif' : '.xlsx'}
          disabled={mutation.isPending}
          onChange={(e) => choose(e.target.files)}
        />
        {files.length > 0 && (
          <p>
            已选择 {files.length} 个文件：{files.map((f) => f.name).join('、')}
          </p>
        )}
        {(validation || mutation.error) && (
          <p role="alert" className="error">
            {validation || mutation.error?.message}
          </p>
        )}
        {mutation.isError && (
          <p>网络失败时可用同一组文件重试。系统复用操作键，避免重复创建批次。</p>
        )}
        <Button
          disabled={
            !files.length || mutation.isPending || (kind === 'photos' && recognitionUnknown)
          }
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? '正在上传…' : '上传并开始预览'}
        </Button>
      </section>
      {recent && (
        <p>
          <Link className="text-link" to={`/imports/${recent}`}>
            继续上次审核 →
          </Link>
        </p>
      )}
    </>
  )
}
