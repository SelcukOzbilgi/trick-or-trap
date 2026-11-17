import type { ReactNode } from "react";

export const PHASE2_PREVIEW_LABEL = "Static preview of a later flow";

/**
 * A visible, inert anchor for a phase-2 entry. It shows the end state of a later flow and a
 * label saying so. It has no link, no button and no input, and uses no state from another
 * page. `id` is the ground-truth entry id.
 */
export function Phase2Preview({
  id,
  as,
  children,
}: {
  id: string;
  as: "li" | "section";
  children?: ReactNode;
}) {
  const Tag = as;
  return (
    <Tag data-testid={id} data-anchor="phase-2" className="bt-variant-row">
      <span>{children}</span>
      <small className="bt-muted">{PHASE2_PREVIEW_LABEL}</small>
    </Tag>
  );
}
