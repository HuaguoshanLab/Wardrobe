import { useEffect, useRef, useState } from 'react'
import { useBlocker, useLocation, useNavigate, useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '../../components/ui/button'
import { Sheet } from '../../components/ui/sheet'
import { PageHeader } from '../../components/ui/page-header'
import { api } from '../../lib/http'
import {
  deleteGarment,
  garmentSchema,
  getGarment,
  getTags,
  getTaxonomy,
  type Attributes,
  type Garment,
} from './api'
import { GarmentEditor } from './garment-editor'
import { GarmentImage } from './image'
import './wardrobe-controls.css'
import './detail.css'

export function GarmentPage() {
  const { id } = useParams()
  const state = useLocation().state as { wardrobeSearch?: string } | null
  const returnTo = state?.wardrobeSearch ? `/wardrobe?${state.wardrobeSearch}` : '/wardrobe'
  const navigate = useNavigate()
  const client = useQueryClient()
  const query = useQuery({
    queryKey: ['garment', id],
    queryFn: () => getGarment(id!),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const taxonomy = useQuery({ queryKey: ['taxonomies'], queryFn: getTaxonomy })
  const tags = useQuery({ queryKey: ['tags'], queryFn: getTags })
  const [editing, setEditing] = useState<Garment | null>(null)
  const [changes, setChanges] = useState<Partial<Attributes>>({})
  const [preview, setPreview] = useState<'original' | 'cutout' | null>(null)
  const [discard, setDiscard] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [notice, setNotice] = useState('')
  const editorRef = useRef<HTMLDivElement>(null)
  const dirty = Object.keys(changes).length > 0
  const mutation = useMutation({
    mutationFn: ({ value, version }: { value: Partial<Attributes>; version: number }) =>
      api(`/garments/${id}`, garmentSchema, {
        method: 'PATCH',
        body: JSON.stringify({ expected_version: version, changes: value }),
      }),
    onSuccess: (item) => {
      client.setQueryData(['garment', id], item)
      void client.invalidateQueries({ queryKey: ['garments'] })
      setEditing(null)
      setChanges({})
      setPreview(null)
      setNotice('已保存')
    },
  })
  const remove = useMutation({
    mutationFn: () => deleteGarment(query.data!),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['garments'] })
      navigate(returnTo, { replace: true })
    },
  })
  const blocker = useBlocker(dirty || mutation.isPending)
  useEffect(() => {
    if (!dirty && !mutation.isPending) return
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty, mutation.isPending])
  const stopEditing = () => {
    setEditing(null)
    setChanges({})
    setDiscard(false)
    mutation.reset()
    setNotice('')
  }
  const item = query.data
  if (!item)
    return (
      <>
        <PageHeader title="单品详情" backTo={returnTo} backLabel="返回衣橱" />
        {query.error ? (
          <p role="alert">
            {query.error.message}
            <Button variant="outline" onClick={() => void query.refetch()}>
              重新读取单品
            </Button>
          </p>
        ) : (
          <p role="status">正在读取单品…</p>
        )}
      </>
    )
  const variant = preview ?? item.display_variant
  const imageUrl = `/api/v1/media/${item.image_asset_id}?variant=${variant}`
  const name = item.name || taxonomy.data?.fields.category[item.category ?? ''] || '未命名单品'
  const text = (key: keyof Attributes) => {
    const value = item[key]
    const values = Array.isArray(value) ? value : value ? [value] : []
    return (
      values
        .map((code) =>
          key === 'custom_tag_ids'
            ? (tags.data?.find((tag) => tag.id === code)?.name ?? '未读取的标签')
            : (taxonomy.data?.fields[key]?.[code] ?? code),
        )
        .join('、') || '未标注'
    )
  }
  return (
    <section className="garment-detail-page">
      <PageHeader
        title={editing ? '编辑单品' : '单品详情'}
        backTo={returnTo}
        backLabel="返回衣橱"
      />
      {notice && (
        <p role="status" className="detail-notice">
          {notice}
        </p>
      )}
      {editing ? (
        <>
          <div className="editor-heading">
            <GarmentImage src={item.image_url} alt={name} />
            <div>
              <h2>{name}</h2>
              <p className="muted">完善信息，让每次搭配更合适。</p>
            </div>
          </div>
          <div ref={editorRef}>
            <GarmentEditor
              initial={editing}
              changes={changes}
              onChange={(value) => {
                setChanges(value)
                setNotice('')
              }}
              busy={mutation.isPending}
              onSave={() => mutation.mutate({ value: changes, version: editing.version })}
              onCancel={() => (dirty ? setDiscard(true) : stopEditing())}
            />
          </div>
        </>
      ) : (
        <div className="garment-detail">
          <div className="detail-visual">
            <Sheet
              title={name}
              trigger={
                <button className="detail-image-trigger" aria-label="放大查看图片">
                  <GarmentImage
                    retry={false}
                    key={imageUrl}
                    className="detail-image"
                    src={imageUrl}
                    alt={name}
                  />
                </button>
              }
            >
              <GarmentImage
                key={imageUrl}
                className="detail-zoom-image"
                src={imageUrl}
                alt={name}
              />
            </Sheet>
            <div className="detail-image-controls" role="group" aria-label="预览图片">
              <button aria-pressed={variant === 'original'} onClick={() => setPreview('original')}>
                原图
              </button>
              <button
                disabled={!item.has_cutout}
                aria-pressed={variant === 'cutout'}
                onClick={() => setPreview('cutout')}
              >
                去背景{!item.has_cutout && '（未生成）'}
              </button>
            </div>
            {variant !== item.display_variant && (
              <Button
                variant="outline"
                disabled={mutation.isPending}
                onClick={() =>
                  mutation.mutate({ value: { display_variant: variant }, version: item.version })
                }
              >
                设为默认展示图
              </Button>
            )}
            <a
              className="text-link detail-download"
              href={`/api/v1/media/${item.image_asset_id}?variant=source`}
            >
              下载原始文件
            </a>
          </div>
          <div className="detail-information">
            <span className="eyebrow">{text('category')}</span>
            <h1>{name}</h1>
            <div className="detail-status">
              <span className={`availability ${item.availability}`}>
                {item.availability === 'available' ? '可穿' : '暂不可用'}
              </span>
              <Button
                variant="outline"
                disabled={mutation.isPending}
                onClick={() =>
                  mutation.mutate({
                    value: {
                      availability: item.availability === 'available' ? 'unavailable' : 'available',
                    },
                    version: item.version,
                  })
                }
              >
                {item.availability === 'available' ? '设为不可用' : '恢复可穿'}
              </Button>
            </div>
            <p className="muted detail-status-hint">
              暂不可用的单品不会参与新搭配，已有穿搭记录会保留。
            </p>
            <Button
              disabled={mutation.isPending}
              onClick={() => {
                setEditing(item)
                setChanges({})
                setNotice('')
                mutation.reset()
              }}
            >
              编辑单品信息
            </Button>
            <section className="detail-attributes">
              <h2>单品档案</h2>
              <dl>
                {(
                  [
                    ['color_codes', '颜色'],
                    ['seasons', '季节'],
                    ['occasion_codes', '场合'],
                    ['style_codes', '风格'],
                    ['material', '材质'],
                    ['thickness', '厚度'],
                    ['warmth', '保暖'],
                    ['custom_tag_ids', '标签'],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key}>
                    <dt>{label}</dt>
                    <dd>{text(key)}</dd>
                  </div>
                ))}
              </dl>
            </section>
            {item.is_demo && <p className="muted">这是一件体验示例，删除后不会重新出现。</p>}
            <Sheet
              title="删除单品"
              open={deleting}
              onOpenChange={(value) => {
                if (!remove.isPending) {
                  setDeleting(value)
                  remove.reset()
                }
              }}
              trigger={
                <button className="detail-delete" disabled={mutation.isPending}>
                  删除这件单品
                </button>
              }
            >
              <div className="delete-preview">
                <GarmentImage src={item.image_url} alt={name} />
                <h3>{name}</h3>
              </div>
              <p>删除后将从衣橱移除，不再用于新搭配。历史穿搭及其图片仍会保留。</p>
              {remove.error && (
                <p role="alert" className="error">
                  {remove.error.message}
                  <Button variant="outline" onClick={() => void query.refetch()}>
                    重新读取单品
                  </Button>
                </p>
              )}
              <div className="actions">
                <Button
                  variant="outline"
                  disabled={remove.isPending}
                  onClick={() => setDeleting(false)}
                >
                  保留单品
                </Button>
                <Button
                  className="button-danger"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate()}
                >
                  {remove.isPending ? '正在删除…' : '确认删除单品'}
                </Button>
              </div>
            </Sheet>
          </div>
        </div>
      )}
      {mutation.error && (
        <div role="alert" className="error detail-save-error">
          <p>{mutation.error.message}。你的修改仍保留。</p>
          <Button
            variant="outline"
            disabled={query.isFetching}
            onClick={async () => {
              const result = await query.refetch()
              if (result.data && !result.isError) {
                if (editing) setEditing(result.data)
                mutation.reset()
                setNotice('已读取最新版本，请检查保留的修改后重新保存。')
              }
            }}
          >
            保留修改并读取最新版本
          </Button>
          {query.error && <p>{query.error.message}</p>}
        </div>
      )}
      <Sheet
        title={mutation.isPending ? '正在保存' : '放弃未保存的修改？'}
        finalFocus={() => editorRef.current?.querySelector('input') ?? false}
        open={discard || blocker.state === 'blocked'}
        onOpenChange={(value) => {
          if (!value) {
            setDiscard(false)
            if (blocker.state === 'blocked') blocker.reset()
          }
        }}
        trigger={<span hidden />}
      >
        <p>{mutation.isPending ? '请等待保存完成后再离开。' : '离开后，本次修改不会保存。'}</p>
        <div className="actions">
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
            disabled={mutation.isPending}
            onClick={() => {
              stopEditing()
              if (blocker.state === 'blocked') blocker.proceed()
            }}
          >
            放弃修改
          </Button>
        </div>
      </Sheet>
    </section>
  )
}
