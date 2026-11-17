export type PerLoadValues = {
  /** Number in "Only N left!". 2 to 9. */
  stockLeft: number;
  /** Number in "N people are viewing this". 8 to 48. */
  viewers: number;
};

const STOCK_MIN = 2;
const STOCK_SPAN = 8;
const VIEWERS_MIN = 8;
const VIEWERS_SPAN = 41;

/** Maps a draw in [0, 1) to an integer in 0..span-1. A draw outside that range is clamped. */
function pick(random: () => number, span: number): number {
  const draw = random();
  const safe = Number.isFinite(draw) ? Math.min(Math.max(draw, 0), 0.999999999) : 0;
  return Math.floor(safe * span);
}

/**
 * Fake per-load numbers for the product page. The first draw gives the stock, the second
 * gives the viewers. The result depends only on `random`.
 */
export function perLoadValues(random: () => number = Math.random): PerLoadValues {
  const stockLeft = STOCK_MIN + pick(random, STOCK_SPAN);
  const viewers = VIEWERS_MIN + pick(random, VIEWERS_SPAN);
  return { stockLeft, viewers };
}
