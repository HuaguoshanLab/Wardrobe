import { expect, it } from 'vitest'
import { needsSourceFix } from './review-row'

it('directs structural Excel errors to the source file even when an image exists', () => {
  const row = { image_asset_id: 'image', conversion_status: 'succeeded', processing_errors: {} }
  expect(
    needsSourceFix({ ...row, processing_errors: { structure: '不支持公式或额外数据列' } }),
  ).toBe(true)
  expect(needsSourceFix({ ...row, processing_errors: { price: '金额不合法' } })).toBe(false)
  expect(needsSourceFix({ ...row, image_asset_id: null, conversion_status: 'failed' })).toBe(true)
})

import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { ReviewRow } from './review-row'
import { rowSchema } from './api'

it('shows proposed subtype and uncertainty before opening processing details', () => {
  const id = '00000000-0000-4000-8000-000000000001'
  const row = rowSchema.parse({
    id,
    row_number: 1,
    filename: 'shirt.png',
    image_asset_id: id,
    image_url: '/photo',
    has_cutout: true,
    version: 3,
    touched_fields: [],
    validation_errors: [],
    processing_errors: {},
    row_status: 'ready',
    conversion_status: 'succeeded',
    analysis_status: 'succeeded',
    cutout_status: 'succeeded',
    analysis_source: 'qwen',
    analysis_notes: ['袖口疑似开线，请核对'],
    confirmed_garment_id: null,
    draft: {
      category: 'top',
      subtype_name: '针织衫',
      name: '蓝色上衣',
      color_codes: [],
      seasons: [],
      occasion_codes: [],
      style_codes: [],
      material: null,
      thickness: null,
      warmth: null,
      custom_tag_ids: [],
      availability: 'available',
      display_variant: 'cutout',
    },
  })
  const noop = () => {}
  render(
    <MemoryRouter>
      <table>
        <tbody>
          <ReviewRow
            row={row}
            fields={{ category: { top: '上装' } }}
            selected={false}
            busy={false}
            onSelect={noop}
            onPreview={noop}
            onEdit={noop}
            onConfirm={noop}
            onAction={noop}
          />
        </tbody>
      </table>
    </MemoryRouter>,
  )
  expect(screen.getByText('子类：针织衫')).toBeVisible()
  expect(screen.getByText('袖口疑似开线，请核对')).toBeVisible()
})
