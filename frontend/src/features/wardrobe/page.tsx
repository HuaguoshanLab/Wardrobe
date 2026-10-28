import { useLayoutEffect, useRef } from 'react'
import { CategoryRail, WardrobeFilters } from './filters'
import './wardrobe-browser.css'
import { Link, useNavigate, useParams, useSearchParams, useLocation } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Shirt, Plus } from 'lucide-react'
import { api } from '../../lib/http'
import { Button } from '../../components/ui/button'
import { AttributeForm } from './attribute-form'
import {
  deleteGarment,
  garmentSchema,
  getGarment,
  getGarments,
  getTags,
  getTaxonomy,
  type Attributes,
} from './api'
import { Tags } from './tags'

export function WardrobePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const filters = Object.fromEntries(searchParams)
  const listRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0
  }, [searchParams.toString()])
  const cursor = searchParams.get('cursor') ?? ''
  const setCursor = (value: string) => {
    const next = new URLSearchParams(searchParams)
    if (value) next.set('cursor', value)
    else next.delete('cursor')
    setSearchParams(next)
  }
  const activeFilters = ['q', 'category', 'season', 'occasion', 'availability', 'tag_id'].some(
    (key) => !!filters[key],
  )
  const taxonomy = useQuery({ queryKey: ['taxonomies'], queryFn: getTaxonomy })
  const tags = useQuery({ queryKey: ['tags'], queryFn: getTags })
  const params = new URLSearchParams({
    ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)),
    ...(cursor ? { cursor } : {}),
  })
  const query = useQuery({
    queryKey: ['garments', params.toString()],
    queryFn: () => getGarments(params),
  })
  const filter = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams)
    if (value) next.set(key, value)
    else next.delete(key)
    next.delete('cursor')
    setSearchParams(next, { replace: true })
  }
  return (
    <section className="wardrobe-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">EVERY PIECE, IN PLACE</span>
          <h1>我的衣橱</h1>
          <p>衣服、鞋和配饰，按你的方式整理。</p>
        </div>
        <Link className="button button-primary" to="/imports">
          <Plus size={18} aria-hidden="true" />
          录入衣服
        </Link>
      </div>
      <WardrobeFilters
        filters={filters}
        fields={taxonomy.data?.fields ?? {}}
        filter={filter}
        tags={tags.data ?? []}
      />
      {(taxonomy.error || tags.error) && (
        <p role="alert" className="error">
          筛选选项读取失败。
          <button
            onClick={() => {
              void taxonomy.refetch()
              void tags.refetch()
            }}
          >
            重试筛选选项
          </button>
        </p>
      )}
      <div className="wardrobe-browser">
        <CategoryRail filters={filters} fields={taxonomy.data?.fields ?? {}} filter={filter} />
        <div
          className="wardrobe-results"
          ref={listRef}
          role="region"
          aria-label="衣橱列表"
          tabIndex={0}
        >
          <div className="wardrobe-summary">
            <span role="status">
              {query.isPending
                ? '正在读取衣橱…'
                : query.data
                  ? `本页 ${query.data.items.length} 件${activeFilters ? ' · 已筛选' : ''}`
                  : ''}
            </span>
            {activeFilters && (
              <Button variant="outline" onClick={() => setSearchParams({})}>
                清除筛选
              </Button>
            )}
          </div>
          {query.isPending && (
            <div className="garment-grid" aria-hidden="true">
              {Array.from({ length: 8 }, (_, i) => (
                <div className="garment-skeleton" key={i} />
              ))}
            </div>
          )}
          {query.error && (
            <p className="error" role="alert">
              {query.error.message}
              <Button variant="outline" onClick={() => void query.refetch()}>
                重试读取衣橱
              </Button>
            </p>
          )}
          {query.data?.items.length === 0 && (
            <section className="panel planned">
              <Shirt size={40} />
              <h2>{activeFilters ? '没有找到匹配的单品' : '让第一件衣服住进来'}</h2>
              <p>
                {activeFilters
                  ? '试试其他关键词，或清除筛选查看全部衣服。'
                  : '上传照片或导入 Excel，审核后就会出现在这里。'}
              </p>
              {activeFilters ? (
                <Button variant="outline" onClick={() => setSearchParams({})}>
                  查看全部衣服
                </Button>
              ) : (
                <Link to="/imports" className="button button-primary">
                  开始录入
                </Link>
              )}
            </section>
          )}
          <div className="garment-grid">
            {query.data?.items.map((item) => (
              <Link
                to={`/wardrobe/${item.id}`}
                state={{ wardrobeSearch: searchParams.toString() }}
                key={item.id}
                className="garment-card"
              >
                <img src={item.image_url} alt={item.name ?? '衣服'} loading="lazy" />
                <div>
                  <h3>
                    {item.name ||
                      taxonomy.data?.fields.category[item.category ?? ''] ||
                      '未命名单品'}
                  </h3>
                  <p
                    className={`availability ${item.availability === 'available' ? 'available' : 'unavailable'}`}
                  >
                    {item.availability === 'available' ? '可穿' : '暂不可用'}
                    {item.is_demo ? ' · 示例' : ''}
                  </p>
                  <span>
                    {item.seasons.map((s) => taxonomy.data?.fields.seasons[s] ?? s).join(' / ') ||
                      '季节未标注'}
                  </span>
                </div>
              </Link>
            ))}
          </div>
          <div className="actions">
            {cursor && (
              <Button variant="outline" onClick={() => setCursor('')}>
                回到第一页
              </Button>
            )}
            {query.data?.next_cursor && (
              <Button variant="outline" onClick={() => setCursor(query.data!.next_cursor!)}>
                下一页
              </Button>
            )}
          </div>
          <Tags />
        </div>
      </div>
    </section>
  )
}

export function GarmentPage() {
  const routeState = useLocation().state as { wardrobeSearch?: unknown } | null
  const returnTo =
    typeof routeState?.wardrobeSearch === 'string' && routeState.wardrobeSearch
      ? `/wardrobe?${routeState.wardrobeSearch}`
      : '/wardrobe'
  const { id } = useParams()
  const navigate = useNavigate()
  const client = useQueryClient()
  const query = useQuery({
    queryKey: ['garment', id],
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: () => getGarment(id!),
  })
  const mutation = useMutation({
    mutationFn: (changes: Partial<Attributes>) =>
      api(`/garments/${id}`, garmentSchema, {
        method: 'PATCH',
        body: JSON.stringify({ expected_version: query.data!.version, changes }),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['garment', id] })
      void client.invalidateQueries({ queryKey: ['garments'] })
    },
  })
  const remove = useMutation({
    mutationFn: () => deleteGarment(query.data!),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['garments'] })
      navigate(returnTo)
    },
  })
  if (query.isPending) return <p>正在读取单品…</p>
  if (query.error || !query.data) return <p role="alert">{query.error?.message ?? '衣服不存在'}</p>
  const item = query.data
  return (
    <>
      <Link to={returnTo} className="text-link">
        ← 返回衣橱
      </Link>
      <div className="page-heading">
        <h1>{item.name || '单品详情'}</h1>
        <Button
          variant="outline"
          className="button-danger"
          disabled={remove.isPending}
          onClick={() => {
            if (window.confirm('删除这件衣服？原图片将保留，不影响未来历史引用。')) remove.mutate()
          }}
        >
          删除单品
        </Button>
      </div>
      {(mutation.error || remove.error) && (
        <p className="error" role="alert">
          {(mutation.error || remove.error)?.message}
        </p>
      )}
      {mutation.isSuccess && <p role="status">已保存</p>}
      <div className="garment-detail">
        <div>
          <img className="detail-image" src={item.image_url} alt={item.name ?? '衣服'} />
          <a className="text-link" href={`/api/v1/media/${item.image_asset_id}?variant=source`}>
            下载保留的原始文件
          </a>
          {item.is_demo && <p className="muted">初次体验示例，可删除，删除后不会重新出现。</p>}
        </div>
        <section className="panel">
          <AttributeForm
            key={item.version}
            initial={item}
            hasCutout={item.has_cutout}
            busy={mutation.isPending}
            onSave={(changes) => mutation.mutate(changes)}
          />
        </section>
      </div>
    </>
  )
}
