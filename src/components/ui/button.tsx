import type { ButtonHTMLAttributes, ReactNode } from "react";
import Link from "next/link";
import type { Route } from "next";
import { IconSpinner } from "./icons";
import { cx } from "./cx";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "outline"
  | "ghost"
  | "destructive"
  | "danger"
  | "success";

export type ButtonSize = "sm" | "md" | "lg";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "btn-primary",
  secondary: "btn-secondary",
  outline: "btn-outline",
  ghost: "btn-ghost",
  // Solid red. For the irreversible thing itself, normally inside a dialog.
  destructive: "btn-destructive",
  // Tinted red. For opening a destructive flow, where solid red overstates it.
  danger: "btn-danger",
  success: "btn-success",
};

const SIZE: Record<ButtonSize, string> = { sm: "btn-sm", md: "", lg: "btn-lg" };

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Swaps the leading icon for a spinner and blocks input, without changing width. */
  loading?: boolean;
  icon?: ReactNode;
  /** Places the icon after the label; for "next" and "open" style actions. */
  iconAfter?: ReactNode;
  fullWidth?: boolean;
  className?: string;
}

/**
 * The only button in the application.
 *
 * Height, radius, weight and icon alignment live in one place so a row of
 * buttons lines up wherever it is assembled. `loading` keeps the label rather
 * than replacing it with "กำลัง…" text: the label is what tells the user what
 * they pressed, and swapping it makes the button change width mid-click.
 */
export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  icon,
  iconAfter,
  fullWidth = false,
  disabled,
  children,
  type = "button",
  className,
  ...props
}: ButtonProps) {
  const iconSize = size === "sm" ? 13 : 15;
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(VARIANT[variant], SIZE[size], fullWidth && "w-full", className)}
      {...props}
    >
      {loading ? <IconSpinner size={iconSize} className="animate-spin" /> : icon}
      {children}
      {!loading ? iconAfter : null}
    </button>
  );
}

export interface IconButtonProps extends Omit<ButtonProps, "children" | "icon" | "iconAfter" | "fullWidth"> {
  /** Required: an icon alone tells a screen reader nothing. */
  label: string;
  icon: ReactNode;
}

/** A square button holding a single icon. The label becomes its accessible name. */
export function IconButton({ label, icon, variant = "ghost", size = "md", loading = false, disabled, className, ...props }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(VARIANT[variant], SIZE[size], size === "sm" ? "btn-icon-sm" : "btn-icon", className)}
      {...props}
    >
      {loading ? <IconSpinner size={size === "sm" ? 13 : 15} className="animate-spin" /> : icon}
    </button>
  );
}

export interface ButtonLinkProps {
  href: Route;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  iconAfter?: ReactNode;
  fullWidth?: boolean;
  className?: string;
  onClick?: () => void;
  children: ReactNode;
}

/** A link that looks like a button. Still a link, so it opens in a new tab. */
export function ButtonLink({ href, variant = "secondary", size = "md", icon, iconAfter, fullWidth, className, children, onClick }: ButtonLinkProps) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={cx(VARIANT[variant], SIZE[size], fullWidth && "w-full", className)}
    >
      {icon}
      {children}
      {iconAfter}
    </Link>
  );
}

/** Same treatment for an external URL, which `next/link` should not own. */
export function ExternalButtonLink({
  href,
  variant = "secondary",
  size = "md",
  icon,
  iconAfter,
  className,
  children,
}: Omit<ButtonLinkProps, "href" | "onClick"> & { href: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={cx(VARIANT[variant], SIZE[size], className)}>
      {icon}
      {children}
      {iconAfter}
    </a>
  );
}
