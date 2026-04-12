import { cn } from '@/lib/utils'

export type StatusTone = 'neutral' | 'success' | 'warning'

export function StatusBadge({
  label,
  tone = 'neutral',
}: {
  label: string
  tone?: StatusTone
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium',
        tone === 'success'
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300'
          : tone === 'warning'
            ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300'
            : 'border-gray-200 bg-white/90 text-gray-600 dark:border-dark-border dark:bg-dark-bg/60 dark:text-gray-300',
      )}
    >
      {label}
    </span>
  )
}
