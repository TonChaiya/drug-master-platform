/**
 * Joins class names, dropping anything falsy.
 *
 * Deliberately not `clsx`: the components here only ever pass strings and
 * conditionals, and a dependency for eight lines is not worth the install.
 */
export function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}
