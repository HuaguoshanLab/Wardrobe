import type { UseQueryResult } from '@tanstack/react-query'
import { Button } from '../../components/ui/button'
import type { getCapabilities } from '../system/api'

export function UploadGuidance({
  kind,
  capability,
}: {
  kind: 'photos' | 'excel'
  capability: UseQueryResult<Awaited<ReturnType<typeof getCapabilities>>, Error>
}) {
  return (
    <div className="import-guidance">
      {kind === 'photos' ? (
        <>
          <p className="import-photo-tip">每张只放一件衣服，平铺或挂拍都可以；鞋可一双合拍。</p>
          <details className="import-help">
            <summary>照片格式与大小限制</summary>
            <p>JPEG、PNG、WebP、HEIC / HEIF；每次最多 20 张，单张 20 MB，总计 200 MB。</p>
          </details>
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
          <h2>先准备表格</h2>
          <p>下载模板 → 每行一件衣服 → 上传检查</p>
          <p>只需图片和品类，其余选填。已有标签不会被 AI 覆盖。</p>
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
            <p>支持 v2 模板及旧 v1，最多 100 行、50 MB；可选填子类、状况、合身及获得收纳资料。</p>
            <p>
              插入浮动嵌入图片，左上角放在对应行的图片列，调高行高让图片完整落在一行内。暂不支持“置于单元格”图片、公式或外链。
            </p>
          </details>
        </>
      )}
    </div>
  )
}
