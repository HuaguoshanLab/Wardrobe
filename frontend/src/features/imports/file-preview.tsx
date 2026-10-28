import { useEffect, useState } from 'react'
import { Image, FileSpreadsheet, X } from 'lucide-react'

export const fileIdentity = (file: File) => `${file.name}:${file.size}:${file.lastModified}`
export function FilePreview({
  file,
  disabled,
  onRemove,
}: {
  file: File
  disabled: boolean
  onRemove: () => void
}) {
  const [url, setUrl] = useState('')
  const [failed, setFailed] = useState(false)
  const excel = /\.xlsx$/i.test(file.name)
  useEffect(() => {
    if (excel || /\.hei[cf]$/i.test(file.name) || !URL.createObjectURL) return
    const value = URL.createObjectURL(file)
    setUrl(value)
    return () => URL.revokeObjectURL(value)
  }, [file, excel])
  return (
    <li className="import-file">
      <div className="import-file-image">
        {url && !failed ? (
          <img src={url} alt={file.name} onError={() => setFailed(true)} />
        ) : (
          <>
            {excel ? <FileSpreadsheet aria-hidden="true" /> : <Image aria-hidden="true" />}
            <small>{excel ? 'Excel 文件' : '上传后预览'}</small>
          </>
        )}
      </div>
      <div className="import-file-caption">
        <strong title={file.name}>{file.name}</strong>
        <small>{(file.size / 1024 / 1024).toFixed(1)} MB</small>
      </div>
      <button
        type="button"
        className="import-file-remove"
        aria-label={`移除 ${file.name}`}
        disabled={disabled}
        onClick={onRemove}
      >
        <X size={16} />
      </button>
    </li>
  )
}

export function selectFiles(current: File[], incoming: File[], kind: 'photos' | 'excel') {
  const files = kind === 'photos' ? [...current] : ([] as File[])
  const errors: string[] = []
  for (const file of incoming) {
    if (files.some((existing) => fileIdentity(existing) === fileIdentity(file))) continue
    const error = !(kind === 'photos' ? /\.(jpe?g|png|webp|heic|heif)$/i : /\.xlsx$/i).test(
      file.name,
    )
      ? '格式不支持'
      : file.size > (kind === 'photos' ? 20 : 50) * 1024 ** 2
        ? '文件过大'
        : files.length >= (kind === 'photos' ? 20 : 1)
          ? '超过文件数量上限'
          : files.reduce((total, item) => total + item.size, 0) + file.size > 200 * 1024 ** 2
            ? '合计超过 200 MB'
            : ''
    if (error) errors.push(`${file.name}：${error}`)
    else files.push(file)
  }
  return { files, errors }
}
