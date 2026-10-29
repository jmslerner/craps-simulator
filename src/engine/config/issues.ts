/**
 * One problem with a machine config, located like a zod issue: `path` is the list of keys from the
 * config's root down to the offending value, so structural (zod) and semantic checks report the
 * same way and an editor can show each message next to its field.
 */
export interface ConfigIssue {
  readonly path: readonly (string | number)[]
  readonly message: string
}

/** Builds an issue; `path` is copied so later pushes to a shared prefix cannot change it. */
export function issue(path: readonly (string | number)[], message: string): ConfigIssue {
  return { path: [...path], message }
}
