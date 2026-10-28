import { StepProgress } from '../../components/ui/step-progress'
import './workflow.css'
import { z } from 'zod'
import { PageHeader } from '../../components/ui/page-header'
import { Images, FileSpreadsheet } from 'lucide-react'
import { useRef, useState } from 'react'
import { useNavigate, Link } from 'react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Button } from '../../components/ui/button'
import { api } from '../../lib/http'
import { operationId } from '../../lib/id'
import { getCapabilities } from '../system/api'
import { Sheet } from '../../components/ui/sheet'
import { LeaveGuard } from './leave-guard'
import { FilePreview, fileIdentity, selectFiles } from './file-preview'
import { acceptedSchema } from './api'

const uploadOperationSchema = z.object({ signature: z.string(), key: z.string() })
function loadUpload() {
  try {
    return uploadOperationSchema.parse(
      JSON.parse(localStorage.getItem('wardrobe.upload') ?? 'null'),
    )
  } catch {
    return null
  }
}
export function ImportPage() {
  const [pending, setPending] = useState(loadUpload)
  const [discardUpload, setDiscardUpload] = useState(false)
  const [kind, setKind] = useState<'photos' | 'excel'>(() => {
    try {
      return JSON.parse(loadUpload()?.signature ?? '{}').kind === 'excel' ? 'excel' : 'photos'
    } catch {
      return 'photos'
    }
  })
  const [files, setFiles] = useState<File[]>([])
  const [validation, setValidation] = useState('')
  const [switchTo, setSwitchTo] = useState<'photos' | 'excel' | null>(null)
  const accepted = useRef(false)
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
      if (pending && pending.signature !== signature)
        throw new Error('请重新选择上次上传的同一组文件，或先放弃待确认上传')
      const key = pending?.key ?? operationId()
      setPending({ signature, key })
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
      setPending(null)
      localStorage.setItem('wardrobe.recentImport', result.import_batch_id)
      accepted.current = true
      setFiles([])
      navigate(`/imports/${result.import_batch_id}`)
    },
  })
  function choose(list: FileList | null) {
    const result = selectFiles(files, Array.from(list ?? []), kind)
    setValidation(result.errors.join('；'))
    setFiles(result.files)
    mutation.reset()
  }
  function switchKind(value: 'photos' | 'excel') {
    setKind(value)
    setFiles([])
    setValidation('')
    mutation.reset()
    setSwitchTo(null)
  }
  return (
    <div className="subpage">
      <PageHeader title="录入衣服" backTo="/wardrobe" backLabel="返回衣橱" />
      <p className="muted">先预览、再确认。只有你确认的单品才会进入衣橱。</p>
      <StepProgress label="录入步骤" steps={['选择文件', '检查修改', '确认入库']} current={0} />
      <div className="import-choices">
        {(['photos', 'excel'] as const).map((value) => (
          <button
            key={value}
            className={`panel import-choice ${kind === value ? 'selected' : ''}`}
            aria-pressed={kind === value}
            disabled={mutation.isPending || !!pending}
            onClick={() => {
              if (value === kind) return
              if (files.length) setSwitchTo(value)
              else switchKind(value)
            }}
          >
            {value === 'photos' ? (
              <Images size={28} aria-hidden="true" />
            ) : (
              <FileSpreadsheet size={28} aria-hidden="true" />
            )}
            <strong>{value === 'photos' ? '批量上传照片' : '导入 Excel'}</strong>
            <span>
              {value === 'photos'
                ? '每张一件 → 识别预填 → 逐行确认'
                : '图片与标签在同一文件 → 检查修改 → 逐行确认'}
            </span>
          </button>
        ))}
      </div>
      {pending && (
        <div className="notice">
          <p>
            上次上传结果尚未确认。刷新不会自动上传；请选择同一组原文件并重试。文件顺序与上次保持一致。
          </p>
          <button
            className="text-link"
            disabled={mutation.isPending}
            onClick={() => setDiscardUpload(true)}
          >
            放弃待确认上传
          </button>
        </div>
      )}
      <Sheet
        title="放弃待确认上传？"
        trigger={<span hidden />}
        open={discardUpload}
        onOpenChange={setDiscardUpload}
      >
        <p>原上传可能已经被服务器接收。放弃后再次上传可能创建新批次；请先检查上次审核结果。</p>
        <div className="actions">
          <Button onClick={() => setDiscardUpload(false)}>保留原请求</Button>
          <Button
            variant="outline"
            onClick={() => {
              localStorage.removeItem('wardrobe.upload')
              setPending(null)
              setDiscardUpload(false)
              mutation.reset()
            }}
          >
            确认放弃上传
          </Button>
        </div>
      </Sheet>
      <section className="panel upload-panel">
        <h2>{kind === 'photos' ? '选择单品照片' : '选择模板文件'}</h2>
        <label className="import-file-picker">
          <span>{kind === 'photos' ? '添加照片' : '选择 Excel 文件'}</span>
          <input
            key={kind}
            aria-label={kind === 'photos' ? '上传照片' : '上传 Excel'}
            type="file"
            multiple={kind === 'photos'}
            accept={kind === 'photos' ? '.jpg,.jpeg,.png,.webp,.heic,.heif' : '.xlsx'}
            disabled={mutation.isPending}
            onChange={(e) => {
              choose(e.target.files)
              e.target.value = ''
            }}
          />
        </label>
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
              {capability.data?.cutout === 'disabled'
                ? '图片在本地转换，去背景未启用。'
                : '图片转换与去背景在本地处理。'}
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
            <a className="button button-outline" href="/api/v1/imports/template" download>
              下载 Excel 模板（含可替换示例）
            </a>
            <details className="import-help">
              <summary>如何填写模板和放置图片？</summary>
              <div className="excel-guide">
                <div>
                  <span>图片列</span>
                  <div>图片完整放在本行内</div>
                </div>
                <div>
                  <span>品类列</span>
                  <div>填写单品品类</div>
                </div>
              </div>
              <p>
                插入浮动嵌入图片，左上角放在对应行的图片列，调高行高让图片完整落在一行内。暂不支持“置于单元格”图片、公式或外链。
              </p>
            </details>
          </>
        )}
        {files.length > 0 && (
          <>
            <p className="import-file-summary">
              已选择 {files.length} {kind === 'photos' ? '张照片' : '个文件'} · 合计{' '}
              {(files.reduce((total, file) => total + file.size, 0) / 1024 ** 2).toFixed(1)} MB
              {kind === 'photos' && ' · 可继续添加照片'}
            </p>
            <ul className="import-files">
              {files.map((file) => (
                <FilePreview
                  key={fileIdentity(file)}
                  file={file}
                  disabled={mutation.isPending}
                  onRemove={() => setFiles(files.filter((item) => item !== file))}
                />
              ))}
            </ul>
          </>
        )}
        {(validation || mutation.error) && (
          <p role="alert" className="error">
            {validation || mutation.error?.message}
          </p>
        )}
        {mutation.isError && (
          <p>
            上传结果尚未确认，请用同一组文件重试，避免重复创建批次。如需更换文件，请先放弃原上传。
          </p>
        )}
        <Button
          disabled={
            !files.length || mutation.isPending || (kind === 'photos' && recognitionUnknown)
          }
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending
            ? '正在上传文件，请稍候…'
            : pending
              ? '重试原上传'
              : kind === 'excel'
                ? '上传并检查 Excel'
                : capability.data?.recognition === 'configured' ||
                    capability.data?.recognition === 'fake'
                  ? '上传并识别照片'
                  : '上传并手工审核'}
        </Button>
      </section>
      <LeaveGuard
        dirty={files.length > 0}
        allowLeave={() => accepted.current}
        busy={mutation.isPending}
      />
      <Sheet
        title="切换录入方式？"
        trigger={<span hidden />}
        open={!!switchTo}
        onOpenChange={(open) => {
          if (!open) setSwitchTo(null)
        }}
      >
        <p>切换后需要重新选择文件，当前所选文件不会上传。</p>
        <div className="actions">
          <Button onClick={() => setSwitchTo(null)}>保留当前选择</Button>
          <Button variant="outline" onClick={() => switchTo && switchKind(switchTo)}>
            确认切换
          </Button>
        </div>
      </Sheet>
      {recent && (
        <p>
          <Link className="text-link" to={`/imports/${recent}`}>
            继续上次审核 →
          </Link>
        </p>
      )}
    </div>
  )
}
