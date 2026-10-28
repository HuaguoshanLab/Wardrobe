import {
  createContext,
  useContext,
  useState,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from 'react'
import { useSheetHistory } from './sheet-history'
import { Dialog } from '@base-ui/react/dialog'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import './sheet.css'

const FooterContext = createContext<HTMLDivElement | null>(null)
export function SheetFooter({ children }: { children: ReactNode }) {
  const target = useContext(FooterContext)
  return target ? createPortal(children, target) : <>{children}</>
}

export function Sheet({
  title,
  trigger,
  children,
  open,
  onOpenChange,
  finalFocus,
}: {
  title: string
  trigger: ReactElement
  children: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  finalFocus?: ComponentProps<typeof Dialog.Popup>['finalFocus']
}) {
  const [footer, setFooter] = useState<HTMLDivElement | null>(null)
  const [internalOpen, setInternalOpen] = useState(false)
  const visible = open ?? internalOpen
  const change = (value: boolean) => {
    if (open === undefined) setInternalOpen(value)
    onOpenChange?.(value)
  }
  useSheetHistory(visible, () => change(false))
  return (
    <Dialog.Root open={visible} onOpenChange={change}>
      <Dialog.Trigger render={trigger} />
      <Dialog.Portal>
        <Dialog.Backdrop className="sheet-backdrop" />
        <Dialog.Popup className="sheet-popup" finalFocus={finalFocus}>
          <header className="sheet-heading">
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close className="sheet-close" aria-label="关闭面板">
              <X size={20} />
            </Dialog.Close>
          </header>
          <FooterContext.Provider value={footer}>
            <div className="sheet-body">{children}</div>
          </FooterContext.Provider>
          <div className="sheet-footer" ref={setFooter} />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
