import { expect, it } from 'vitest'
import { selectFiles } from './file-preview'

it('keeps valid selections and reports individual invalid files while appending and deduplicating', () => {
  const first = new File(['one'], 'one.png', { lastModified: 1 })
  const next = new File(['two'], 'two.heic', { lastModified: 2 })
  const result = selectFiles([first], [first, next, new File(['x'], 'bad.txt')], 'photos')
  expect(result.files).toEqual([first, next])
  expect(result.errors).toEqual(['bad.txt：格式不支持'])
})
it('rejects per-file and count limits without clearing earlier photos', () => {
  const files = Array.from({ length: 20 }, (_, i) => new File(['x'], `${i}.jpg`))
  const large = new File(['x'], 'large.jpg')
  Object.defineProperty(large, 'size', { value: 21 * 1024 ** 2 })
  const result = selectFiles(files, [large, new File(['x'], 'extra.jpg')], 'photos')
  expect(result.files).toEqual(files)
  expect(result.errors).toEqual(['large.jpg：文件过大', 'extra.jpg：超过文件数量上限'])
})
it('checks the cumulative photo limit and Excel extension', () => {
  const files = Array.from({ length: 10 }, (_, i) => {
    const file = new File(['x'], `${i}.jpg`)
    Object.defineProperty(file, 'size', { value: 20 * 1024 ** 2 })
    return file
  })
  expect(selectFiles(files, [new File(['x'], 'extra.png')], 'photos').errors).toEqual([
    'extra.png：合计超过 200 MB',
  ])
  expect(selectFiles([], [new File(['x'], 'legacy.xls')], 'excel').files).toEqual([])
})
