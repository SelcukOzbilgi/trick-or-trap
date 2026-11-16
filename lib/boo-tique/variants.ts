/** Shape of the `searchParams` record Next.js passes to a page. */
export type SearchParamsRecord = Record<string, string | string[] | undefined>;

/**
 * Pick a variant from a raw query value.
 * Uses the first value of an array. Returns `fallback` for `undefined` and for
 * any value that is not in `allowed`. Never throws.
 */
export function pickVariant<T extends string>(
  raw: string | string[] | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return fallback;
  return allowed.find((candidate) => candidate === value) ?? fallback;
}
