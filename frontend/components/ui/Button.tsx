import type { ButtonHTMLAttributes, ReactNode } from 'react'

// Shared button primitive (presentability pass, 2026-07-11). Before this, every
// panel hand-rolled its own button class string, which is exactly why the UI
// read as "slapped together" -- inconsistent padding, no focus rings, no press
// feedback. One source of truth now. Craft baked in per the ui-ux-pro-max
// rules: cursor-pointer on every clickable, a visible focus-visible ring
// (accessibility-critical), a subtle transform-only active press (no layout
// shift), 150ms transitions, and a clear disabled state.
//
// `buttonClasses()` is exported separately so <Link>/<a> can wear the same look
// (a real anchor, not a button, must stay an anchor for navigation semantics).

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md'

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-md font-medium cursor-pointer ' +
  'transition-[background-color,color,transform,box-shadow] duration-150 ' +
  'active:scale-[0.98] ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ' +
  'focus-visible:ring-offset-2 focus-visible:ring-offset-surface ' +
  'disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100'

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-contrast hover:bg-accent-hover',
  secondary: 'border border-hairline-strong text-ink hover:bg-accent-wash',
  ghost: 'text-ink-secondary hover:bg-accent-wash hover:text-ink',
  danger: 'text-ink-secondary hover:bg-critical-wash hover:text-critical',
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
}

export function buttonClasses(
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
  extra = '',
): string {
  return `${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${extra}`.trim()
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  children: ReactNode
}

export default function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button className={buttonClasses(variant, size, className)} {...rest}>
      {children}
    </button>
  )
}
