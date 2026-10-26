import { Button as BaseButton } from '@base-ui/react/button'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils'

const variants = cva('button', {
  variants: { variant: { default: 'button-primary', outline: 'button-outline' } },
  defaultVariants: { variant: 'default' },
})

export function Button({
  className,
  variant,
  ...props
}: BaseButton.Props & VariantProps<typeof variants>) {
  return <BaseButton className={cn(variants({ variant }), className)} {...props} />
}
