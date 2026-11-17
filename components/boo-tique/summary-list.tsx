import { formatUsd, type SummaryRow } from "@/lib/boo-tique/cart";

/** The `<dl>` of summary rows. Every figure is `formatUsd` of the cents in the shared source. */
export function SummaryList({
  rows,
  testId,
}: {
  rows: readonly SummaryRow[];
  testId: string;
}) {
  return (
    <dl className="bt-list" data-testid={testId}>
      {rows.map((row) => (
        <div key={row.key} className="bt-variant-row">
          <dt>{row.label}</dt>
          <dd className="bt-price">{formatUsd(row.cents)}</dd>
        </div>
      ))}
    </dl>
  );
}
