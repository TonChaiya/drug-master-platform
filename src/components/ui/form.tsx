"use client";

import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { useId } from "react";
import { cx } from "./cx";
import { IconSearch } from "./icons";

export interface FieldProps {
  label: ReactNode;
  htmlFor: string;
  /** Guidance shown before anything goes wrong. Hidden once `error` is set. */
  help?: ReactNode;
  /** Replaces the help text and marks the control invalid. */
  error?: string | null;
  required?: boolean;
  children: ReactNode;
  className?: string;
}

/**
 * Label, control, and one line beneath it.
 *
 * The message under a control is either help or an error, never both: showing
 * an error while the original hint still sits next to it is how a form ends up
 * saying two things at once. The error carries `role="alert"` so it is
 * announced when it appears.
 */
export function Field({ label, htmlFor, help, error, required, children, className }: FieldProps) {
  return (
    <div className={cx("min-w-0", className)}>
      <label className="label" htmlFor={htmlFor}>
        {label}
        {required ? (
          <span className="ml-0.5 text-danger" aria-hidden>
            *
          </span>
        ) : null}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} role="alert" className="mt-1 text-xxs leading-[1.15rem] text-danger">
          {error}
        </p>
      ) : help ? (
        <p id={`${htmlFor}-help`} className="type-help mt-1">
          {help}
        </p>
      ) : null}
    </div>
  );
}

export interface TextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "size"> {
  invalid?: boolean;
  /** Tabular figures and a monospace face; for drug codes and facility codes. */
  mono?: boolean;
  className?: string;
}

export function TextInput({ invalid, mono, className, id, ...props }: TextInputProps) {
  return (
    <input
      id={id}
      aria-invalid={invalid || undefined}
      aria-describedby={invalid && id ? `${id}-error` : undefined}
      className={cx("field", invalid && "field-invalid", mono && "font-mono tabular-nums", className)}
      {...props}
    />
  );
}

export function SelectInput({
  invalid,
  className,
  children,
  id,
  ...props
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, "className"> & { invalid?: boolean; className?: string }) {
  return (
    <select
      id={id}
      aria-invalid={invalid || undefined}
      className={cx("field-select", invalid && "field-invalid", className)}
      {...props}
    >
      {children}
    </select>
  );
}

export function TextareaInput({
  invalid,
  className,
  ...props
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className"> & { invalid?: boolean; className?: string }) {
  return <textarea aria-invalid={invalid || undefined} className={cx("field-multiline", invalid && "field-invalid", className)} {...props} />;
}

export function FileInput({ className, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "type"> & { className?: string }) {
  return <input type="file" className={cx("field-file", className)} {...props} />;
}

/** A text input with the search icon inside it, so the control explains itself. */
export function SearchInput({ className, id, ...props }: TextInputProps) {
  return (
    <div className="relative">
      <IconSearch size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
      <input id={id} type="search" className={cx("field pl-8", className)} {...props} />
    </div>
  );
}

export interface ChoiceProps {
  label: ReactNode;
  description?: ReactNode;
  className?: string;
  /** Emphasises the label, for the one option in a list that is destructive. */
  emphasis?: "danger";
}

/**
 * A checkbox or radio with its label and explanation, in a hit area that covers
 * the whole row rather than the 16px control.
 */
export function Choice({
  label,
  description,
  className,
  emphasis,
  type = "checkbox",
  ...props
}: ChoiceProps & Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "type"> & { type?: "checkbox" | "radio" }) {
  const generated = useId();
  const id = props.id ?? generated;
  return (
    <label
      htmlFor={id}
      className={cx(
        "flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-slate-50",
        props.disabled && "cursor-not-allowed opacity-60",
        className,
      )}
    >
      <input id={id} type={type} className="check-control mt-0.5" {...props} />
      <span className="min-w-0">
        <span className={cx("block text-xxs font-semibold", emphasis === "danger" ? "text-danger" : "text-slate-700")}>{label}</span>
        {description ? <span className="type-help mt-0.5 block">{description}</span> : null}
      </span>
    </label>
  );
}

/**
 * A row of filters that wraps predictably.
 *
 * Search sits first and takes the remaining width, filters keep their natural
 * width, and actions are pushed to the end — so the eye finds the same three
 * zones on the mapping, catalog and standards screens.
 */
export function FilterBar({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end gap-2.5">
      {children}
      {actions ? <div className="ml-auto flex flex-wrap items-end gap-2">{actions}</div> : null}
    </div>
  );
}
