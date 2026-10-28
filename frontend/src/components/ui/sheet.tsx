import type { ReactElement, ReactNode } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { X } from 'lucide-react'
import './sheet.css'

export function Sheet({
  title,
  trigger,
  children,
  open,
  onOpenChange,
}: {
  title: string
  trigger: ReactElement
  children: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Trigger render={trigger} />
      <Dialog.Portal>
        <Dialog.Backdrop className="sheet-backdrop" />
        <Dialog.Popup className="sheet-popup">
          <div className="sheet-handle" aria-hidden="true" />
          <header className="sheet-heading">
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close className="sheet-close" aria-label="关闭面板">
              <X size={20} />
            </Dialog.Close>
          </header>
          <div className="sheet-body">{children}</div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
