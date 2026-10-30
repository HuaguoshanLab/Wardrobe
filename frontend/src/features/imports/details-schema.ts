import { z } from 'zod'

export const importDetailsSchema = z.object({
  subtype_name: z.string().max(40).nullable().default(null),
  source: z.enum(['purchased', 'gift', 'other']).nullable().default(null),
  acquired_on: z.iso
    .date('请输入有效日期')
    .nullable()
    .default(null)
    .refine(
      (value) =>
        !value || value <= new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }),
      '获得日期不能在未来',
    ),
  price: z
    .string()
    .nullable()
    .default(null)
    .refine(
      (value) => value === null || /^\d{1,8}(\.\d{1,2})?$/.test(value),
      '金额需为非负数，最多八位整数和两位小数',
    ),
  location: z.string().max(120).nullable().default(null),
  condition: z.enum(['unknown', 'good', 'worn', 'needs_repair', 'damaged']).default('unknown'),
  fit: z.enum(['unknown', 'fits', 'unfit', 'not_applicable']).default('unknown'),
  storage: z.enum(['daily', 'stored']).default('daily'),
  notes: z.string().max(2000).default(''),
})
export type ImportDetails = z.infer<typeof importDetailsSchema>
