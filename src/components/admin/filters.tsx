'use client'

import { useId, useState, useTransition } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Loader2, RotateCcw, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export type FilterOption = { value: string; label: string }

/**
 * Filters that write themselves into the URL, so an administrator can bookmark,
 * share or reload a filtered view and the page still works without JavaScript.
 * `page` is dropped whenever a filter changes, because the old offset belongs to
 * the old result set.
 */
function useUrlParamWriter(clearParams: string[]) {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()

  function writeParam(param: string, value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set(param, value)
    else params.delete(param)
    for (const cleared of clearParams) params.delete(cleared)

    const query = params.toString()
    startTransition(() => {
      router.replace(query ? `${pathname}?${query}` : pathname)
    })
  }

  return { writeParam, isPending }
}

export function UrlSelectFilter({
  param,
  labelText,
  options,
  value,
  clearParams = ['page'],
  className,
}: {
  param: string
  labelText: string
  options: FilterOption[]
  value: string
  clearParams?: string[]
  className?: string
}) {
  const { writeParam, isPending } = useUrlParamWriter(clearParams)
  const id = useId()

  return (
    <div className={className}>
      <Label htmlFor={id} className="mb-1.5">
        {labelText}
      </Label>
      <Select
        id={id}
        name={param}
        value={value}
        items={options}
        onValueChange={(next) => {
          writeParam(param, next == null ? '' : String(next))
        }}
      >
        <SelectTrigger className="w-full" aria-busy={isPending}>
          <SelectValue placeholder={`Choose ${labelText.toLowerCase()}`} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

export function UrlSearchFilter({
  param,
  labelText,
  placeholder,
  value,
  clearParams = ['page'],
}: {
  param: string
  labelText: string
  placeholder?: string
  value: string
  clearParams?: string[]
}) {
  const { writeParam, isPending } = useUrlParamWriter(clearParams)
  const id = useId()
  const [term, setTerm] = useState(value)

  return (
    <form
      className="w-full"
      onSubmit={(event) => {
        event.preventDefault()
        writeParam(param, term.trim())
      }}
    >
      <Label htmlFor={id} className="mb-1.5">
        {labelText}
      </Label>
      <div className="flex gap-2">
        <Input
          id={id}
          name={param}
          type="search"
          value={term}
          placeholder={placeholder}
          onChange={(event) => setTerm(event.target.value)}
          className="flex-1"
        />
        <Button type="submit" disabled={isPending} className="shrink-0 bg-brand-600 hover:bg-brand-700">
          {isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Search className="size-4" aria-hidden />}
          Search
        </Button>
      </div>
    </form>
  )
}

/** Clears the listed params and returns to the first page of the unfiltered view. */
export function FilterResetLink({ params, href }: { params: string[]; href: string }) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const [isPending, startTransition] = useTransition()

  const hasActiveFilter = params.some((param) => Boolean(searchParams.get(param)))
  if (!hasActiveFilter) return null

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={isPending}
      onClick={() => {
        const next = new URLSearchParams(searchParams.toString())
        for (const param of params) next.delete(param)
        const query = next.toString()
        startTransition(() => router.replace(query ? `${pathname}?${query}` : href))
      }}
    >
      <RotateCcw className="size-3.5" aria-hidden />
      Clear filters
    </Button>
  )
}
