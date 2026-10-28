import { useState } from 'react'
import { ImageOff } from 'lucide-react'

export function GarmentImage({
  src,
  alt,
  className = '',
  retry = true,
}: {
  src: string
  alt: string
  className?: string
  retry?: boolean
}) {
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  return failed ? (
    <span className={`garment-image-fallback ${className}`}>
      <ImageOff size={28} aria-hidden="true" />
      <span>图片暂不可用</span>
      {retry && (
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            setAttempt(attempt + 1)
            setFailed(false)
          }}
        >
          重试图片
        </button>
      )}
    </span>
  ) : (
    <img
      key={attempt}
      className={className}
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  )
}
