/**
 * Form controls. Each control is a single labelled element with a hairline
 * border, a paper field background and an amber focus ring.
 */
import clsx from 'clsx'
import type { ComponentProps, ReactNode } from 'react'
import { useId } from 'react'

/* ------------------------------------------------------------------ */
/* Field                                                               */
/* ------------------------------------------------------------------ */

export interface FieldProps {
  label?: ReactNode
  /** English caption rendered above the label, e.g. "MEMORY". */
  caption?: ReactNode
  hint?: ReactNode
  error?: ReactNode
  required?: boolean
  htmlFor?: string
  /** Put label and control on one line. */
  inline?: boolean
  className?: string
  children: ReactNode
}

export function Field({ label, caption, hint, error, required, htmlFor, inline, className, children }: FieldProps) {
  return (
    <div className={clsx('rh-field', inline && 'rh-field--inline', error && 'is-invalid', className)}>
      {label || caption ? (
        <div className="rh-field__head">
          {caption ? <span className="rh-field__caption rh-caption">{caption}</span> : null}
          {label ? (
            <label className="rh-field__label" htmlFor={htmlFor}>
              {label}
              {required ? <span className="rh-field__required" aria-hidden="true">*</span> : null}
            </label>
          ) : null}
        </div>
      ) : null}
      <div className="rh-field__control">{children}</div>
      {error ? (
        <p className="rh-field__error" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="rh-field__hint">{hint}</p>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Input                                                               */
/* ------------------------------------------------------------------ */

export interface InputProps extends ComponentProps<'input'> {
  invalid?: boolean
  mono?: boolean
  suffix?: ReactNode
  leading?: ReactNode
}

export function Input({ invalid, mono, suffix, leading, className, ...rest }: InputProps) {
  const field = (
    <input
      {...rest}
      aria-invalid={invalid || undefined}
      className={clsx('rh-input', mono && 'rh-input--mono', invalid && 'is-invalid', className)}
    />
  )
  if (!suffix && !leading) return field
  return (
    <span className={clsx('rh-input-wrap', invalid && 'is-invalid')}>
      {leading ? <span className="rh-input-wrap__slot">{leading}</span> : null}
      {field}
      {suffix ? <span className="rh-input-wrap__slot rh-input-wrap__slot--trailing">{suffix}</span> : null}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* Select                                                              */
/* ------------------------------------------------------------------ */

export interface SelectProps extends ComponentProps<'select'> {
  invalid?: boolean
}

export function Select({ invalid, className, children, ...rest }: SelectProps) {
  return (
    <span className={clsx('rh-select-wrap', invalid && 'is-invalid')}>
      <select {...rest} aria-invalid={invalid || undefined} className={clsx('rh-select', className)}>
        {children}
      </select>
      <span className="rh-select__chevron" aria-hidden="true">
        <svg width="9" height="6" viewBox="0 0 9 6" fill="none">
          <path d="M0.5 0.75L4.5 5.25L8.5 0.75" stroke="currentColor" strokeWidth="1" />
        </svg>
      </span>
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* Textarea                                                            */
/* ------------------------------------------------------------------ */

export interface TextareaProps extends ComponentProps<'textarea'> {
  invalid?: boolean
  mono?: boolean
}

export function Textarea({ invalid, mono, className, ...rest }: TextareaProps) {
  return (
    <textarea
      {...rest}
      aria-invalid={invalid || undefined}
      className={clsx('rh-textarea', mono && 'rh-textarea--mono', invalid && 'is-invalid', className)}
    />
  )
}

/* ------------------------------------------------------------------ */
/* Switch                                                              */
/* ------------------------------------------------------------------ */

export interface SwitchProps {
  checked: boolean
  onCheckedChange?: (checked: boolean) => void
  disabled?: boolean
  label?: ReactNode
  id?: string
  className?: string
}

export function Switch({ checked, onCheckedChange, disabled, label, id, className }: SwitchProps) {
  const autoId = useId()
  const controlId = id ?? autoId
  return (
    <span className={clsx('rh-switch', checked && 'is-on', disabled && 'is-disabled', className)}>
      <button
        type="button"
        id={controlId}
        role="switch"
        aria-checked={checked}
        aria-label={typeof label === 'string' ? label : undefined}
        disabled={disabled}
        className="rh-switch__track"
        onClick={() => onCheckedChange?.(!checked)}
      >
        <span className="rh-switch__thumb" />
      </button>
      {label ? (
        <label className="rh-switch__label" htmlFor={controlId}>
          {label}
        </label>
      ) : null}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* Checkbox                                                            */
/* ------------------------------------------------------------------ */

export interface CheckboxProps {
  checked: boolean
  onCheckedChange?: (checked: boolean) => void
  disabled?: boolean
  indeterminate?: boolean
  label?: ReactNode
  id?: string
  className?: string
}

export function Checkbox({ checked, onCheckedChange, disabled, indeterminate, label, id, className }: CheckboxProps) {
  const autoId = useId()
  const controlId = id ?? autoId
  return (
    <span className={clsx('rh-checkbox', disabled && 'is-disabled', className)}>
      <button
        type="button"
        id={controlId}
        role="checkbox"
        aria-checked={indeterminate ? 'mixed' : checked}
        aria-label={typeof label === 'string' ? label : undefined}
        disabled={disabled}
        className={clsx('rh-checkbox__box', checked && 'is-checked', indeterminate && 'is-mixed')}
        onClick={() => onCheckedChange?.(!checked)}
      >
        {indeterminate ? (
          <span className="rh-checkbox__dash" />
        ) : checked ? (
          <svg width="10" height="8" viewBox="0 0 10 8" fill="none" aria-hidden="true">
            <path d="M1 4.1L3.6 6.8L9 1" stroke="currentColor" strokeWidth="1.4" />
          </svg>
        ) : null}
      </button>
      {label ? (
        <label className="rh-checkbox__label" htmlFor={controlId}>
          {label}
        </label>
      ) : null}
    </span>
  )
}
