"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

// Which customer is selected on the map. The map writes it and the Top customers table reads it to mark the row, so both sit inside one
// provider on the page. Outside a provider nothing is ever selected, which is what the table shows on its own.
interface Selection {
  selectedId: string | null;
  select(id: string | null): void;
}

const Context = createContext<Selection>({ selectedId: null, select: () => undefined });

export function CustomerSelectionProvider({ children, initialId = null }: { children: ReactNode; initialId?: string | null }) {
  const [selectedId, setSelectedId] = useState<string | null>(initialId);
  const value = useMemo<Selection>(() => ({ selectedId, select: setSelectedId }), [selectedId]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export const useCustomerSelection = (): Selection => useContext(Context);

// The id the table gives a customer's row, so the map can scroll to it. Ids are pseudonyms (CUST_ and a hash); anything else is made safe.
export const rowDomId = (customerId: string): string => `customer-row-${customerId.replace(/[^A-Za-z0-9_-]/g, "_")}`;
