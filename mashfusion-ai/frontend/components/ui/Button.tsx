'use client'
import { forwardRef } from 'react'
import { cn } from '@/lib/utils'
import { motion } from 'framer-motion'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  icon?: React.ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', loading, icon, children, disabled, ...props }, ref) => {
    const base = 'inline-flex items-center justify-center gap-2 font-semibold rounded-xl transition-all duration-200 select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/50 disabled:opacity-50 disabled:cursor-not-allowed'

    const variants = {
      primary:   'btn-primary',
      secondary: 'btn-secondary',
      ghost:     'btn-ghost',
      danger:    'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-all',
    }

    const sizes = {
      sm: 'text-xs px-3 py-1.5',
      md: 'text-sm px-5 py-2.5',
      lg: 'text-base px-7 py-3.5',
    }

    return (
      <motion.button
        ref={ref}
        whileTap={disabled || loading ? {} : { scale: 0.97 }}
        className={cn(base, variants[variant], sizes[size], className)}
        disabled={disabled || loading}
        {...(props as React.ComponentProps<typeof motion.button>)}
      >
        {loading ? (
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        ) : icon}
        {children}
      </motion.button>
    )
  }
)
Button.displayName = 'Button'
