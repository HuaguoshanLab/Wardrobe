import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Shirt } from 'lucide-react'
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
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [cursor, setCursor] = useState('')
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
    setFilters((previous) => ({ ...previous, [key]: value }))
    setCursor('')
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">EVERY PIECE, IN PLACE</span>
          <h1>我的衣橱</h1>
          <p>衣服、鞋和配饰，按你的方式整理。</p>
        </div>
        <Link className="button button-primary" to="/imports">
          录入衣服
        </Link>
      </div>
      <div className="wardrobe-filters">
        <input
          aria-label="搜索衣服"
          placeholder="搜索名称"
          value={filters.q ?? ''}
          onChange={(e) => filter('q', e.target.value)}
        />
        {[
          ['category', '品类', 'category'],
          ['season', '季节', 'seasons'],
          ['occasion', '场合', 'occasion_codes'],
          ['availability', '状态', 'availability'],
        ].map(([key, label, field]) => (
          <select
            key={key}
            aria-label={`筛选${label}`}
            value={filters[key] ?? ''}
            onChange={(e) => filter(key, e.target.value)}
          >
            <option value="">全部{label}</option>
            {Object.entries(taxonomy.data?.fields[field] ?? {}).map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
        ))}
        <select
          aria-label="筛选标签"
          value={filters.tag_id ?? ''}
          onChange={(e) => filter('tag_id', e.target.value)}
        >
          <option value="">全部标签</option>
          {tags.data?.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
      {query.isPending && <p>正在读取衣橱…</p>}
      {query.error && (
        <p className="error" role="alert">
          {query.error.message}
        </p>
      )}
      {query.data?.items.length === 0 && (
        <section className="panel planned">
          <Shirt size={40} />
          <h2>这里还没有衣服</h2>
          <p>上传照片或导入 Excel，审核后就会出现在这里。</p>
          <Link to="/imports" className="text-link">
            开始录入
          </Link>
        </section>
      )}
      <div className="garment-grid">
        {query.data?.items.map((item) => (
          <Link to={`/wardrobe/${item.id}`} key={item.id} className="garment-card">
            <img src={item.image_url} alt={item.name ?? '衣服'} loading="lazy" />
            <div>
              <h3>
                {item.name || taxonomy.data?.fields.category[item.category ?? ''] || '未命名单品'}
              </h3>
              <p>
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
    </>
  )
}

export function GarmentPage() {
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
      navigate('/wardrobe')
    },
  })
  if (query.isPending) return <p>正在读取单品…</p>
  if (query.error || !query.data) return <p role="alert">{query.error?.message ?? '衣服不存在'}</p>
  const item = query.data
  return (
    <>
      <Link to="/wardrobe" className="text-link">
        ← 返回衣橱
      </Link>
      <div className="page-heading">
        <h1>{item.name || '单品详情'}</h1>
        <Button
          variant="outline"
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
