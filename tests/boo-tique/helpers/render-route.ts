import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BooTiqueShell } from "@/components/boo-tique/shell";
import type { SearchParamsRecord } from "@/lib/boo-tique/variants";
import { ROUTE_TABLE, type RouteTableEntry } from "./route-table";

const BASE_URL = "http://boo-tique.test";

function segments(path: string): string[] {
  return path.replace(/^\/+|\/+$/g, "").split("/");
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Matches a pathname against a route pattern. `[name]` segments match exactly one non-empty
 * segment and become params. Returns the params, or `null` when the path does not match.
 */
export function matchRoutePattern(
  pattern: string,
  pathname: string,
): Record<string, string> | null {
  const wanted = segments(pattern);
  const actual = segments(pathname);
  if (wanted.length !== actual.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < wanted.length; i += 1) {
    const dynamic = /^\[([^\]]+)\]$/.exec(wanted[i]);
    if (dynamic) {
      if (actual[i] === "") return null;
      params[dynamic[1]] = safeDecode(actual[i]);
    } else if (wanted[i] !== actual[i]) {
      return null;
    }
  }
  return params;
}

function toSearchParamsRecord(searchParams: URLSearchParams): SearchParamsRecord {
  const record: SearchParamsRecord = {};
  for (const [key, value] of searchParams) {
    const existing = record[key];
    if (existing === undefined) record[key] = value;
    else if (Array.isArray(existing)) existing.push(value);
    else record[key] = [existing, value];
  }
  return record;
}

/**
 * Renders a route to static markup without a browser. Awaits the page function, passes
 * `params` and `searchParams` as Promises, and wraps the result in `BooTiqueShell` unless
 * `shell` is false. Throws when no table entry matches the path.
 */
export async function renderRoute(
  route: string,
  options: { table?: readonly RouteTableEntry[]; shell?: boolean } = {},
): Promise<string> {
  const table = options.table ?? ROUTE_TABLE;
  const url = new URL(route, BASE_URL);
  let params: Record<string, string> | null = null;
  let entry: RouteTableEntry | undefined;
  for (const candidate of table) {
    params = matchRoutePattern(candidate.pattern, url.pathname);
    if (params) {
      entry = candidate;
      break;
    }
  }
  if (!entry || !params) {
    throw new Error(`No route-table entry for ${url.pathname}`);
  }
  const mod = await entry.load();
  const element = await mod.default({
    params: Promise.resolve(params),
    searchParams: Promise.resolve(toSearchParamsRecord(url.searchParams)),
  });
  const wrapped =
    options.shell === false
      ? createElement(Fragment, null, element)
      : createElement(BooTiqueShell, null, element);
  return renderToStaticMarkup(wrapped);
}
