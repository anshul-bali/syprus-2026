'use client'

import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { describedBy, FieldError, restored } from '@/components/forms/form-parts'
import type { ActionState } from '@/lib/action-state'
import { cn } from '@/lib/utils'

export type Item = { value: string; label: string }

function Wrapper({
  id,
  name = id,
  label,
  required,
  help,
  state,
  children,
  className,
}: {
  id: string
  name?: string
  label: string
  required?: boolean
  help?: string
  state?: ActionState
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={id} className="text-[13px] font-medium">
        {label}
        {required ? <span className="ml-1 text-brand-700">*</span> : <span className="ml-1 text-xs text-muted-foreground">(optional)</span>}
      </Label>
      {children}
      {help ? <p className="text-xs leading-relaxed text-muted-foreground">{help}</p> : null}
      {state ? <FieldError state={state} name={name} id={id} /> : null}
    </div>
  )
}

export function TextField({
  id,
  name = id,
  label,
  state,
  type = 'text',
  required,
  help,
  placeholder,
  defaultValue,
  min,
  max,
  step,
  className,
  maxLength,
}: {
  id: string
  name?: string
  label: string
  state?: ActionState
  type?: 'text' | 'number' | 'date' | 'email'
  required?: boolean
  help?: string
  placeholder?: string
  defaultValue?: string | number
  min?: number
  max?: number
  step?: number
  className?: string
  maxLength?: number
}) {
  return (
    <Wrapper id={id} name={name} label={label} required={required} help={help} state={state} className={className}>
      <Input
        id={id}
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        defaultValue={restored(state, name, defaultValue)}
        min={min}
        max={max}
        step={step}
        maxLength={maxLength}
        aria-describedby={describedBy(name, state, id)}
        aria-invalid={state?.status === 'error' && state.fieldErrors?.[name] ? true : undefined}
        className="w-full"
      />
    </Wrapper>
  )
}

export function TextAreaField({
  id,
  name = id,
  label,
  state,
  required,
  help,
  placeholder,
  defaultValue,
  rows = 4,
  className,
}: {
  id: string
  name?: string
  label: string
  state?: ActionState
  required?: boolean
  help?: string
  placeholder?: string
  defaultValue?: string
  rows?: number
  className?: string
}) {
  return (
    <Wrapper id={id} name={name} label={label} required={required} help={help} state={state} className={className}>
      <Textarea
        id={id}
        name={name}
        required={required}
        rows={rows}
        placeholder={placeholder}
        defaultValue={restored(state, name, defaultValue)}
        aria-describedby={describedBy(name, state, id)}
        aria-invalid={state?.status === 'error' && state.fieldErrors?.[name] ? true : undefined}
        className="w-full"
      />
    </Wrapper>
  )
}

export function SelectField({
  id,
  name = id,
  label,
  items,
  state,
  required,
  help,
  defaultValue,
  placeholder = 'Choose one',
  className,
}: {
  id: string
  name?: string
  label: string
  items: Item[]
  state?: ActionState
  required?: boolean
  help?: string
  defaultValue?: string
  placeholder?: string
  className?: string
}) {
  const map: Record<string, string> = Object.fromEntries(items.map((item) => [item.value, item.label]))
  return (
    <Wrapper id={id} name={name} label={label} required={required} help={help} state={state} className={className}>
      <div className="flex flex-col gap-1">
        {/* A server-supplied default is a *starting* value: when a save changes
            it the field must remount, rather than mutating an uncontrolled
            component after initialisation. */}
        <Select key={`${name}:${defaultValue ?? 'unset'}`} name={name} items={map} required={required} defaultValue={defaultValue}>
          <SelectTrigger id={id} className="w-full">
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </Wrapper>
  )
}

export function CheckboxField({
  name,
  label,
  help,
  defaultChecked,
}: {
  name: string
  label: string
  help?: string
  defaultChecked?: boolean
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Checkbox id={name} name={name} defaultChecked={defaultChecked} className="mt-0.5" />
      <div className="flex flex-col gap-0.5">
        <Label htmlFor={name} className="text-[13px] font-medium">
          {label}
        </Label>
        {help ? <p className="text-xs leading-relaxed text-muted-foreground">{help}</p> : null}
      </div>
    </div>
  )
}
