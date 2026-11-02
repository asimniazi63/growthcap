"use client";

import type { ReactNode } from "react";
import { rowDomId, useCustomerSelection } from "./customer-selection";

// One row of the Top customers table. The cells are rendered on the server and passed in; this only marks the row when its customer is the
// one selected on the map: a tinted row, a brand-colour edge, and aria-current for assistive technology (so it is not colour alone).
export function TopCustomerRow({ customerId, children }: { customerId: string; children: ReactNode }) {
  const { selectedId } = useCustomerSelection();
  const on = selectedId === customerId;
  return (
    <tr
      id={rowDomId(customerId)}
      aria-current={on ? "true" : undefined}
      className={on ? "[&>td]:bg-brand-tint [&>td:first-child]:shadow-[inset_3px_0_0_var(--color-brand)]" : undefined}
    >
      {children}
    </tr>
  );
}
