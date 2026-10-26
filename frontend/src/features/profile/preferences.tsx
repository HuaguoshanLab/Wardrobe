import { useState } from 'react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '../../components/ui/button'
import { getTaxonomy } from '../wardrobe'
import { Choices } from './choices'
import {
  getPreferences,
  preferencesSchema,
  preferencesView,
  saveProfile,
  type Preferences,
} from './api'
import { discardProfileSave, restoreProfileSave, retryProfileSave } from './profile-save'

const path = '/profile/preferences'
const pendingSchema = z.object({ preferences: preferencesSchema, expected_version: z.int().min(1) })
const restore = () => restoreProfileSave(path, pendingSchema)

export function PreferencesPanel() {
  const query = useQuery({ queryKey: ['preferences'], queryFn: getPreferences })
  const [revision, setRevision] = useState(0)
  if (!query.data)
    return (
      <p role={query.isError ? 'alert' : 'status'}>{query.error?.message ?? '正在载入偏好…'}</p>
    )
  return (
    <PreferenceEditor
      key={revision}
      initial={query.data}
      reload={async () => {
        const result = await query.refetch()
        if (!result.isSuccess) return
        discardProfileSave(path)
        setRevision((value) => value + 1)
      }}
    />
  )
}

function PreferenceEditor({
  initial,
  reload,
}: {
  initial: { preferences: Preferences; version: number }
  reload: () => Promise<void>
}) {
  const client = useQueryClient()
  const [pending, setPending] = useState(restore)
  const [version, setVersion] = useState(pending?.payload.expected_version ?? initial.version)
  const defaults = pending?.payload.preferences ?? initial.preferences
  const form = useForm<Preferences>({ defaultValues: defaults })
  const taxonomy = useQuery({ queryKey: ['taxonomy'], queryFn: getTaxonomy })
  const values = form.watch()
  const save = useMutation({
    mutationFn: (preferences: Preferences) =>
      pending
        ? retryProfileSave(path, preferencesView, pending)
        : saveProfile(path, preferencesView, { preferences, expected_version: version }),
    onError: () => setPending(restore()),
    onSuccess: (result) => {
      setPending(null)
      setVersion(result.version)
      form.reset(result.preferences)
      client.setQueryData(['preferences'], result)
    },
  })
  return (
    <section className="panel profile-panel">
      <h2>长期偏好</h2>
      <p>只保存你明确填写的偏好；未选择代表未知，本次条件可覆盖风格。</p>
      <form className="attribute-form" onSubmit={form.handleSubmit((data) => save.mutate(data))}>
        <fieldset disabled={save.isPending || !!pending} className="plain-fieldset">
          <Choices
            label="偏好风格"
            options={taxonomy.data?.fields.style_codes ?? {}}
            value={values.style_codes}
            onChange={(v) => form.setValue('style_codes', v)}
          />
          <div className="attribute-grid">
            <label>
              版型
              <select
                {...form.register('fit', { setValueAs: (v: string) => v || null })}
                defaultValue={defaults.fit ?? ''}
              >
                <option value="">未知 / 不指定</option>
                <option value="fitted">修身</option>
                <option value="regular">合身</option>
                <option value="loose">宽松</option>
              </select>
            </label>
            <label>
              冷热倾向
              <select
                {...form.register('thermal', { setValueAs: (v: string) => v || null })}
                defaultValue={defaults.thermal ?? ''}
              >
                <option value="">未知 / 不指定</option>
                <option value="cold_sensitive">怕冷</option>
                <option value="heat_sensitive">怕热</option>
                <option value="neutral">无明显倾向</option>
              </select>
            </label>
          </div>
          <Choices
            label="喜欢的颜色"
            options={taxonomy.data?.fields.color_codes ?? {}}
            value={values.preferred_colors}
            onChange={(v) => form.setValue('preferred_colors', v)}
          />
          <Choices
            label="避开的颜色"
            options={taxonomy.data?.fields.color_codes ?? {}}
            value={values.avoided_colors}
            onChange={(v) => form.setValue('avoided_colors', v)}
          />
          <label>
            偏好补充
            <textarea
              maxLength={1000}
              {...form.register('notes', { setValueAs: (v: string | null) => v?.trim() || null })}
            />
          </label>
          <Button type="submit">{save.isPending ? '正在保存…' : '保存偏好'}</Button>
        </fieldset>
      </form>
      {pending && (
        <div className="notice">
          <p>已恢复待确认的偏好保存。请重发原操作，或放弃草稿并重新载入后编辑。</p>
          <Button
            disabled={save.isPending}
            onClick={() => save.mutate(pending.payload.preferences)}
          >
            重发原保存操作
          </Button>
        </div>
      )}
      {taxonomy.isError && <p role="alert">{taxonomy.error.message}</p>}
      {save.isError && (
        <p className="error" role="alert">
          {save.error.message}。草稿已保留，可重试保存，或重新载入后编辑。
        </p>
      )}
      {save.isSuccess && <p role="status">偏好已保存</p>}
      <button className="text-link" disabled={save.isPending} onClick={() => void reload()}>
        放弃草稿并重新载入偏好
      </button>
    </section>
  )
}
