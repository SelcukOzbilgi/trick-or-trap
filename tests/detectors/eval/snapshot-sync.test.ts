import { describe, it, expect } from "vitest";
import { createProductPage } from "@/components/boo-tique/product-page";
import { perLoadValues } from "@/lib/boo-tique/per-load";
import { PageSnapshotSchema } from "@/lib/types";
import { loadFixture, fixtureRoutes } from "@/tests/boo-tique/helpers/fixture";
import { attr as attrOf, decodeEntities, hasAttr } from "@/tests/boo-tique/helpers/markup";
import { renderRoute } from "@/tests/boo-tique/helpers/render-route";
import type { PageProps, RouteTableEntry } from "@/tests/boo-tique/helpers/route-table";
import { assertNoTestHooks, tagForEntry } from "@/tests/detectors/eval/helpers/no-hooks";
import type { PageNode } from "@/tests/detectors/eval/helpers/tree";
import {
  CLASS_STYLE_PROPS,
  CLIENT_STATE_KEYS,
  PAGE_VARIANTS,
  RELOAD_GAP_SECONDS,
  buildVariantSnapshot,
  sequence,
  variantById,
} from "@/tests/detectors/eval/helpers/pages";
import type { PageVariant } from "@/tests/detectors/eval/helpers/pages";
import { ENTRY_MAP, entriesOfVariant, nodesOf } from "@/tests/detectors/eval/helpers/entry-map";
import type { EntryMapping } from "@/tests/detectors/eval/helpers/entry-map";

// ── Helpers ────────────────────────────────────────────────────────────────

type Sample = "first" | "reload";
const SAMPLES: readonly Sample[] = ["first", "reload"];

const PRODUCT_ROUTE = "/boo-tique/product/ghost-pepper-candle";

function collapse(text: string): string {
  return text.split(/\s+/).filter((part) => part !== "").join(" ");
}

function maskDigits(text: string): string {
  return text.replace(/\d/g, "9");
}

function must<T>(value: T | undefined | null, what: string): T {
  if (value === undefined || value === null) throw new Error(`Missing ${what}`);
  return value;
}

function treeOf(variant: PageVariant, sample: Sample): PageNode {
  return sample === "first" ? variant.first : variant.reload;
}

function walk(node: PageNode, visit: (n: PageNode) => void): void {
  visit(node);
  for (const child of node.children ?? []) walk(child, visit);
}

function allNodes(root: PageNode): PageNode[] {
  const nodes: PageNode[] = [];
  walk(root, (n) => nodes.push(n));
  return nodes;
}

function findNode(root: PageNode, key: string): PageNode {
  return must(
    allNodes(root).find((n) => n.key === key),
    `tree node "${key}"`,
  );
}

/** The `innerText` of a tree node as the sync test reads it: own text, then the children (inputs have none). */
function innerTextOf(node: PageNode): string {
  const parts: string[] = [];
  if (node.text !== undefined) parts.push(node.text);
  for (const child of node.children ?? []) {
    if (child.tag === "input") continue;
    parts.push(innerTextOf(child));
  }
  return collapse(parts.join(" "));
}

function isLeaf(node: PageNode): boolean {
  return (node.children ?? []).length === 0;
}

/** Text runs between the tags of static markup: decoded and whitespace-collapsed, blanks left out. */
function textRuns(markup: string): string[] {
  const runs: string[] = [];
  let from = 0;
  while (from < markup.length) {
    const lt = markup.indexOf("<", from);
    const end = lt === -1 ? markup.length : lt;
    const run = collapse(decodeEntities(markup.slice(from, end)));
    if (run !== "") runs.push(run);
    if (lt === -1) break;
    const gt = markup.indexOf(">", lt);
    if (gt === -1) break;
    from = gt + 1;
  }
  return runs;
}

/** Opening tag of the only element that is exactly `<tag ...>text</tag>`. */
function openTagOfText(markup: string, tag: string, text: string): string {
  const needle = `>${text}</${tag}>`;
  const first = markup.indexOf(needle);
  if (first === -1) throw new Error(`No <${tag}> with the text "${text}" in the markup`);
  if (markup.indexOf(needle, first + 1) !== -1) {
    throw new Error(`More than one <${tag}> with the text "${text}" in the markup`);
  }
  const start = markup.lastIndexOf("<", first);
  return markup.slice(start, first + 1);
}

function inlineStyleOf(openTag: string): Map<string, string> {
  const out = new Map<string, string>();
  const raw = attrOf(openTag, "style");
  if (raw === undefined) return out;
  for (const part of raw.split(";")) {
    const colon = part.indexOf(":");
    if (colon === -1) continue;
    out.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim());
  }
  return out;
}

/** The four style values the detectors read, mapped to the property names React writes inline. */
const STYLE_PROPS = [
  { prop: "fontSize", css: ["font-size"] },
  { prop: "color", css: ["color"] },
  { prop: "backgroundColor", css: ["background", "background-color"] },
  { prop: "opacity", css: ["opacity"] },
] as const;

/** Attributes the capture records on any element, plus the aria ones the shop uses. */
const ATTRIBUTE_NAMES = [
  "type",
  "name",
  "href",
  "for",
  "placeholder",
  "value",
  "aria-checked",
  "aria-label",
  "aria-labelledby",
  "aria-modal",
  "aria-live",
] as const;

const markupCache = new Map<string, Promise<string>>();

function markupOf(variant: PageVariant, sample: Sample): Promise<string> {
  const cacheKey = `${variant.id}/${sample}`;
  const cached = markupCache.get(cacheKey);
  if (cached !== undefined) return cached;
  let rendered: Promise<string>;
  if (variant.draws === undefined) {
    rendered = renderRoute(variant.route, { shell: true });
  } else {
    // Render the product page the way render-route does, with the injected random draws.
    const page = createProductPage(sequence(variant.draws[sample]));
    const table: RouteTableEntry[] = [
      {
        pattern: "/boo-tique/product/[slug]",
        load: async () => ({
          default: ({ params }: PageProps) => page({ params: params.then((all) => ({ slug: all.slug })) }),
        }),
      },
    ];
    rendered = renderRoute(variant.route, { table, shell: true });
  }
  markupCache.set(cacheKey, rendered);
  return rendered;
}

/** Compares a tree node with the opening tag of the markup element it mirrors. */
function expectNodeMatchesTag(node: PageNode, openTag: string, label: string): void {
  expect(attrOf(openTag, "role"), `${label}: role`).toBe(node.role);
  for (const name of ATTRIBUTE_NAMES) {
    expect(attrOf(openTag, name), `${label}: attribute ${name}`).toBe(node.attrs?.[name]);
  }
  expect(hasAttr(openTag, "disabled"), `${label}: disabled`).toBe(node.attrs?.disabled !== undefined);
  expect(hasAttr(openTag, "checked"), `${label}: checked`).toBe(node.checked === true);

  const inline = inlineStyleOf(openTag);
  const nodeStyle = (node.style ?? {}) as Record<string, unknown>;
  const classProps: readonly string[] = CLASS_STYLE_PROPS[node.key ?? ""] ?? [];
  for (const { prop, css } of STYLE_PROPS) {
    const markupValue = css.map((name) => inline.get(name)).find((value) => value !== undefined);
    const treeValue = nodeStyle[prop];
    const shown = treeValue === undefined ? undefined : String(treeValue);
    if (markupValue !== undefined) {
      expect(shown, `${label}: inline ${prop}`).toBe(markupValue);
    } else if (shown !== undefined) {
      expect(classProps, `${label}: ${prop} is not inline, so it must be declared class-based`).toContain(prop);
    }
  }
}

function textMatches(treeText: string, markupText: string, key: string | undefined): boolean {
  if (key !== undefined && CLIENT_STATE_KEYS.includes(key)) {
    return maskDigits(treeText) === maskDigits(markupText);
  }
  return treeText === markupText;
}

const FIXTURE = loadFixture();
const SCORED = FIXTURE.filter(
  (entry) => !(entry.detectionSignals.length === 1 && entry.detectionSignals[0] === "not-static"),
);

// ── The variants ───────────────────────────────────────────────────────────

describe("page variants", () => {
  it("has unique ids and routes that exist in the fixture", () => {
    const ids = PAGE_VARIANTS.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
    const routes = new Set(fixtureRoutes());
    for (const variant of PAGE_VARIANTS) {
      expect(routes.has(variant.route), `route of ${variant.id}`).toBe(true);
    }
  });

  it("covers every fixture route the scored entries use", () => {
    const variantRoutes = new Set(PAGE_VARIANTS.map((v) => v.route));
    for (const entry of SCORED) expect(variantRoutes.has(entry.route), entry.id).toBe(true);
  });

  it("reloads 9 seconds after the first read", () => {
    expect(RELOAD_GAP_SECONDS).toBe(9);
    for (const variant of PAGE_VARIANTS) {
      const gap = (Date.parse(variant.reloadAt) - Date.parse(variant.capturedAt)) / 1000;
      expect(gap, variant.id).toBe(RELOAD_GAP_SECONDS);
    }
  });

  it("looks up a variant by id and throws on an unknown id", () => {
    expect(variantById("cart").id).toBe("cart");
    expect(() => variantById("nope")).toThrow(/nope/);
  });

  for (const variant of PAGE_VARIANTS) {
    it(`builds a valid snapshot without any data-* attribute: ${variant.id}`, () => {
      const { snapshot, keyToId } = buildVariantSnapshot(variant);
      expect(PageSnapshotSchema.safeParse(snapshot).success).toBe(true);
      expect(() => assertNoTestHooks(snapshot)).not.toThrow();
      expect(snapshot.afterReload?.capture?.light).toBe(true);
      expect(snapshot.afterReload?.capturedAt).toBe(variant.reloadAt);
      expect(snapshot.capturedAt).toBe(variant.capturedAt);
      expect(snapshot.afterReload?.elements.length).toBeGreaterThan(0);
      expect(snapshot.elements.length).toBeGreaterThan(10);
      expect(snapshot.capture?.elementsTruncated).toBe(false);
      expect(keyToId.size).toBeGreaterThan(0);
    });
  }

  it("gives the first and the reload tree the same keys in the same positions", () => {
    for (const variant of PAGE_VARIANTS) {
      const first = [...buildVariantSnapshot(variant).keyToId];
      const keys = (root: PageNode) => allNodes(root).flatMap((n) => (n.key === undefined ? [] : [n.key]));
      expect(keys(variant.reload), variant.id).toEqual(keys(variant.first));
      expect(first.length, variant.id).toBe(keys(variant.first).length);
    }
  });

  it("shows the same tree in both samples unless the page has client state or per-load numbers", () => {
    const changing = new Set(["home-default-increase", "club", "product-differing"]);
    for (const variant of PAGE_VARIANTS) {
      if (changing.has(variant.id)) continue;
      expect(JSON.stringify(variant.reload), variant.id).toBe(JSON.stringify(variant.first));
    }
  });

  it("builds the hero pairs, the club pair and the toast pair of requirements 16.6 to 16.8", () => {
    const text = (variant: PageVariant, sample: Sample, key: string) =>
      innerTextOf(findNode(treeOf(variant, sample), key));
    const equal = variantById("home-default-equal");
    expect(text(equal, "first", "hero-countdown")).toBe("Boo-nanza ends in 04:59:59");
    expect(text(equal, "reload", "hero-countdown")).toBe("Boo-nanza ends in 04:59:59");
    const increase = variantById("home-default-increase");
    expect(text(increase, "first", "hero-countdown")).toBe("Boo-nanza ends in 04:59:58");
    expect(text(increase, "reload", "hero-countdown")).toBe("Boo-nanza ends in 04:59:59");
    const club = variantById("club");
    expect(text(club, "first", "club-timer")).toBe("Join in 09:59 for 20% off");
    expect(text(club, "reload", "club-timer")).toBe("Join in 09:50 for 20% off");
    const product = variantById("product-differing");
    expect(text(product, "first", "sold-message")).toBe("Morgan from Ohio just bought the Cursed Candle Set");
    expect(text(product, "reload", "sold-message")).toBe(text(product, "first", "sold-message"));
  });
});

// ── The entry map ──────────────────────────────────────────────────────────

describe("entry map", () => {
  it("covers exactly the 27 scored fixture entries (19 flag, 8 look-alike)", () => {
    expect(SCORED).toHaveLength(27);
    expect(SCORED.filter((e) => e.expectedVerdict === "flag")).toHaveLength(19);
    expect(SCORED.filter((e) => e.expectedVerdict === "no-flag")).toHaveLength(8);
    expect(Object.keys(ENTRY_MAP).sort()).toEqual(SCORED.map((e) => e.id).sort());
  });

  it("leaves the three not-static entries out", () => {
    for (const id of ["cart-insurance-sneaked", "checkout-handling-fees-drip", "account-cancel-five-screens"]) {
      expect(ENTRY_MAP[id], id).toBeUndefined();
    }
  });

  it("puts every entry on variants of its own route, with keys that exist in both trees", () => {
    for (const entry of SCORED) {
      const mapping: EntryMapping = must(ENTRY_MAP[entry.id], `mapping of ${entry.id}`);
      expect(mapping.variants.length, entry.id).toBeGreaterThan(0);
      for (const variantId of mapping.variants) {
        const variant = variantById(variantId);
        expect(variant.route, `${entry.id} on ${variantId}`).toBe(entry.route);
        const { keyToId } = buildVariantSnapshot(variant);
        for (const key of nodesOf(entry.id)) {
          expect(keyToId.has(key), `${entry.id}: key ${key} on ${variantId}`).toBe(true);
        }
        for (const sample of SAMPLES) {
          for (const key of nodesOf(entry.id)) findNode(treeOf(variant, sample), key);
        }
      }
    }
  });

  it("marks exactly the two honest whole-page entries as whole-page", () => {
    const whole = Object.entries(ENTRY_MAP)
      .filter(([, mapping]) => mapping.wholePage)
      .map(([id]) => id)
      .sort();
    expect(whole).toEqual(["account-one-click-cancel-plan", "checkout-consistent-shipping-tax"]);
  });

  it("uses each tree key for at most one entry as its primary node", () => {
    const seen = new Set<string>();
    for (const [id, mapping] of Object.entries(ENTRY_MAP)) {
      for (const variantId of mapping.variants) {
        const slot = `${variantId}/${mapping.primary}`;
        expect(seen.has(slot), `${id} reuses ${slot}`).toBe(false);
        seen.add(slot);
      }
    }
  });
});

// ── Sync with the rendered markup ──────────────────────────────────────────

for (const variant of PAGE_VARIANTS) {
  describe(`sync with the shop markup: ${variant.id}`, () => {
    for (const sample of SAMPLES) {
      it(`mirrors every planted element in the ${sample} sample`, async () => {
        const markup = await markupOf(variant, sample);
        const root = treeOf(variant, sample);
        const entries = entriesOfVariant(variant.id);

        for (const { id, mapping } of entries) {
          const hooked = tagForEntry(markup, id);
          const node = findNode(root, mapping.primary);
          const label = `${id} (${mapping.primary}, ${sample})`;
          expect(
            textMatches(innerTextOf(node), collapse(hooked.text), node.key),
            `${label}: tree text "${innerTextOf(node)}" vs markup text "${hooked.text}"`,
          ).toBe(true);
          expectNodeMatchesTag(node, hooked.openTag, label);

          for (const key of mapping.related) {
            const related = findNode(root, key);
            if (!isLeaf(related) || related.text === undefined) continue;
            const tag = openTagOfText(markup, related.tag, related.text);
            expectNodeMatchesTag(related, tag, `${id} related ${key} (${sample})`);
          }
        }
      });

      it(`lists the planted nodes in markup order in the ${sample} sample`, async () => {
        const markup = await markupOf(variant, sample);
        const root = treeOf(variant, sample);
        const keysInOrder = allNodes(root).flatMap((n) => (n.key === undefined ? [] : [n.key]));
        const planted = entriesOfVariant(variant.id).map(({ id, mapping }) => ({
          id,
          treeOrder: keysInOrder.indexOf(mapping.primary),
          markupPosition: markup.indexOf(tagForEntry(markup, id).openTag),
        }));
        for (const item of planted) {
          expect(item.treeOrder, `${item.id} in the tree`).toBeGreaterThanOrEqual(0);
          expect(item.markupPosition, `${item.id} in the markup`).toBeGreaterThanOrEqual(0);
        }
        const byTree = [...planted].sort((a, b) => a.treeOrder - b.treeOrder);
        const byMarkup = [...planted].sort((a, b) => a.markupPosition - b.markupPosition);
        expect(byTree.map((p) => p.id)).toEqual(byMarkup.map((p) => p.id));
      });

      it(`shows every visible text run of the markup in the tree, and nothing else, in the ${sample} sample`, async () => {
        const markup = await markupOf(variant, sample);
        const root = treeOf(variant, sample);
        const nodes = allNodes(root);
        const treeTexts = new Set<string>();
        const clientTexts = new Set<string>();
        for (const node of nodes) {
          if (node.text === undefined) continue;
          const text = collapse(node.text);
          if (text === "") continue;
          if (node.key !== undefined && CLIENT_STATE_KEYS.includes(node.key)) clientTexts.add(maskDigits(text));
          else treeTexts.add(text);
        }
        const runs = textRuns(markup);
        const runSet = new Set(runs);
        const maskedRuns = new Set(runs.map(maskDigits));

        for (const run of runs) {
          const known = treeTexts.has(run) || clientTexts.has(maskDigits(run));
          expect(known, `markup text "${run}" is missing from the tree of ${variant.id}`).toBe(true);
        }
        for (const text of treeTexts) {
          expect(runSet.has(text), `tree text "${text}" of ${variant.id} is not in the markup`).toBe(true);
        }
        for (const masked of clientTexts) {
          expect(maskedRuns.has(masked), `client-state text "${masked}" of ${variant.id} is not in the markup`).toBe(true);
        }
      });
    }
  });
}

// ── Product numbers ────────────────────────────────────────────────────────

describe("product numbers", () => {
  const claims = (stock: number, viewers: number) => ({
    stock: `Only ${stock} left!`,
    viewers: `${viewers} people are viewing this`,
  });

  for (const id of ["product-differing", "product-coinciding"]) {
    it(`takes the numbers of ${id} from perLoadValues with the injected random functions`, async () => {
      const variant = variantById(id);
      const draws = must(variant.draws, "draws");
      for (const sample of SAMPLES) {
        const values = perLoadValues(sequence(draws[sample]));
        const expected = claims(values.stockLeft, values.viewers);
        const root = treeOf(variant, sample);
        expect(innerTextOf(findNode(root, "low-stock"))).toBe(expected.stock);
        expect(innerTextOf(findNode(root, "viewers"))).toBe(expected.viewers);
        const markup = await markupOf(variant, sample);
        expect(textRuns(markup)).toContain(expected.stock);
        expect(textRuns(markup)).toContain(expected.viewers);
      }
    });
  }

  it("differs between the loads of the differing pair: stock 2 then 6, viewers 14 then 31", () => {
    const variant = variantById("product-differing");
    const draws = must(variant.draws, "draws");
    expect(perLoadValues(sequence(draws.first))).toEqual({ stockLeft: 2, viewers: 14 });
    expect(perLoadValues(sequence(draws.reload))).toEqual({ stockLeft: 6, viewers: 31 });
  });

  it("repeats the same numbers in the coinciding pair", () => {
    const variant = variantById("product-coinciding");
    const draws = must(variant.draws, "draws");
    expect(perLoadValues(sequence(draws.first))).toEqual(perLoadValues(sequence(draws.reload)));
    expect(JSON.stringify(variant.reload)).toBe(JSON.stringify(variant.first));
  });

  it("keeps the real inventory at 3 in every product sample", () => {
    for (const id of ["product-differing", "product-coinciding"]) {
      for (const sample of SAMPLES) {
        const node = findNode(treeOf(variantById(id), sample), "real-inventory");
        expect(innerTextOf(node)).toBe("3 left");
      }
    }
  });

  it("rejects an exhausted random sequence", () => {
    const next = sequence([0.1]);
    expect(next()).toBe(0.1);
    expect(() => next()).toThrow();
  });
});

// ── States of planted controls in the built snapshots ──────────────────────

describe("states of planted controls", () => {
  function elementOf(variantId: string, key: string) {
    const { snapshot, keyToId } = buildVariantSnapshot(variantById(variantId));
    const id = must(keyToId.get(key), `key ${key}`);
    return must(
      snapshot.elements.find((e) => e.id === id),
      `element ${id}`,
    );
  }

  it("starts the cart controls the way the shop does", () => {
    expect(elementOf("cart", "protection-input").checked).toBe(true);
    expect(elementOf("cart", "gift-wrap-input").checked).toBe(false);
    expect(elementOf("cart", "warranty-none-input").checked).toBe(false);
    expect(elementOf("cart", "warranty-silver-input").checked).toBe(false);
    expect(elementOf("cart", "warranty-gold-input").checked).toBe(true);
    expect(elementOf("cart", "shipping-standard-input").checked).toBe(true);
    expect(elementOf("cart", "shipping-express-input").checked).toBe(false);
    const toggle = elementOf("cart", "packaging-switch");
    expect(toggle.role).toBe("switch");
    expect(toggle.attributes?.["aria-checked"]).toBe("true");
    expect(toggle.checked).toBe(false);
  });

  it("starts the checkout and modal checkboxes the way the shop does", () => {
    expect(elementOf("checkout-default", "newsletter-input").checked).toBe(true);
    expect(elementOf("home-exit-intent", "partners-input").checked).toBe(true);
    expect(elementOf("home-exit-intent", "optin-input").checked).toBe(false);
  });

  it("gives the radios of one group the same name", () => {
    for (const key of ["warranty-none-input", "warranty-silver-input", "warranty-gold-input"]) {
      expect(elementOf("cart", key).attributes?.name).toBe("warranty");
    }
    for (const key of ["shipping-standard-input", "shipping-express-input", "shipping-overnight-input"]) {
      expect(elementOf("cart", key).attributes?.name).toBe("shipping");
    }
  });

  it("makes the dialogs dialogs and the close controls small or large as in the shop", () => {
    const upsell = elementOf("product-differing", "upsell-dialog");
    expect(upsell.role).toBe("dialog");
    expect(upsell.attributes?.["aria-modal"]).toBe("true");
    expect(upsell.position).toBe("fixed");
    const close = elementOf("product-differing", "upsell-close");
    expect(close.fontSize).toBe("8px");
    expect(close.color).toBe("rgb(207, 198, 188)");
    expect(close.boundingBox.width).toBeLessThan(16);
    expect(close.boundingBox.height).toBeLessThan(16);
    const modal = elementOf("home-exit-intent", "exit-close");
    expect(modal.boundingBox.width).toBeGreaterThan(16);
  });

  it("makes the sold toast a status area and the banner a fixed region", () => {
    expect(elementOf("product-differing", "sold-toast").role).toBe("status");
    const banner = elementOf("home-default-equal", "cookie-banner");
    expect(banner.role).toBe("region");
    expect(banner.position).toBe("fixed");
  });

  it("keeps the harness numbers of the cookie banner next to the fixture notes", () => {
    const accept = elementOf("home-default-equal", "cookie-accept");
    const options = elementOf("home-default-equal", "cookie-options");
    expect(accept.fontSize).toBe("20px");
    expect(options.fontSize).toBe("11px");
    expect(options.color).toBe("rgb(154, 154, 154)");
    const ratio =
      (accept.boundingBox.width * accept.boundingBox.height) / (options.boundingBox.width * options.boundingBox.height);
    expect(ratio).toBeGreaterThan(2);
    const ghost = elementOf("home-ghost", "cookie-reject");
    expect(ghost.opacity).toBe("0.6");
    expect(ghost.color).toBe("rgb(179, 179, 179)");
  });
});
