'use client'

import { useSyncExternalStore } from 'react'
import { Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Button } from '@/components/ui/button'
import {
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu'

/**
 * The server cannot know which theme a visitor will get, so anything that
 * renders the current choice must wait for hydration. `useSyncExternalStore`
 * answers that without an effect that sets state during mount.
 */
const subscribe = () => () => {}

/** True only on the client, after hydration. Shared by theme-aware widgets. */
export function useHydrated() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  )
}

/** Icon-only control for the public header and the portal header. */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme()
  const hydrated = useHydrated()
  const isDark = hydrated && resolvedTheme === 'dark'

  if (!hydrated) {
    // Same footprint as the real button, so the header does not jump.
    return <span aria-hidden className={className ? `inline-block size-8 shrink-0 ${className}` : 'inline-block size-8 shrink-0'} />
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className={className}
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      aria-label={`Colour theme: ${isDark ? 'dark' : 'light'}. Switch to the ${isDark ? 'light' : 'dark'} theme.`}
    >
      {isDark ? <Moon className="size-4" aria-hidden /> : <Sun className="size-4" aria-hidden />}
    </Button>
  )
}

/** Appearance choices for the account menu, where “system” stays reachable. */
export function ThemeMenuGroup() {
  const { theme, setTheme } = useTheme()
  const hydrated = useHydrated()
  const options = [
    { value: 'system', label: 'Use device setting' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ] as const

  return (
    <>
      <DropdownMenuLabel inset>Appearance</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={hydrated ? (theme ?? 'system') : ''}>
        {options.map((option) => (
          <DropdownMenuRadioItem key={option.value} value={option.value} onClick={() => setTheme(option.value)}>
            {option.label}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </>
  )
}
