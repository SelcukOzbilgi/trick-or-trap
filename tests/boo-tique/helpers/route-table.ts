import type { ReactNode } from "react";
import type { SearchParamsRecord } from "@/lib/boo-tique/variants";

export type PageProps = {
  params: Promise<Record<string, string>>;
  searchParams: Promise<SearchParamsRecord>;
};

/**
 * `default` is declared as a method so its parameter is compared bivariantly. A page that
 * only takes `{ params: Promise<{ slug: string }> }` is then assignable.
 */
export type PageModule = {
  default(props: PageProps): ReactNode | Promise<ReactNode>;
};

export type RouteTableEntry = {
  /** Path pattern; `[name]` segments match one path segment and become params. */
  pattern: string;
  load: () => Promise<PageModule>;
};

/**
 * One entry per built page. A page task adds its `load` line here, for example
 * `{ pattern: "/boo-tique", load: () => import("@/app/boo-tique/page") }`.
 */
export const ROUTE_TABLE: readonly RouteTableEntry[] = [
  { pattern: "/boo-tique", load: () => import("@/app/boo-tique/page") },
  { pattern: "/boo-tique/club", load: () => import("@/app/boo-tique/club/page") },
  {
    pattern: "/boo-tique/product/[slug]",
    // The page takes `{ slug }`; the harness passes a generic params record, so adapt it.
    load: async () => {
      const mod = await import("@/app/boo-tique/product/[slug]/page");
      return {
        default: ({ params }: PageProps) =>
          mod.default({ params: params.then((all) => ({ slug: all.slug })) }),
      };
    },
  },
];
