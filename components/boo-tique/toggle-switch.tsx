"use client";

import { useState } from "react";

/**
 * The packaging switch. It flips its own `aria-checked` value and nothing else: no figure
 * changes, nothing is stored and nothing is sent. The server markup carries the initial value.
 */
export function ToggleSwitch({
  labelId,
  testId,
  defaultChecked,
}: {
  labelId: string;
  testId: string;
  defaultChecked: boolean;
}) {
  const [checked, setChecked] = useState(defaultChecked);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelId}
      className="bt-toggle"
      data-testid={testId}
      onClick={() => setChecked((value) => !value)}
    >
      <span className="bt-toggle-knob" />
    </button>
  );
}
