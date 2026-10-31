// Friendly names for every tool the assistant can call (the main agent's, the "why did we miss plan" investigators' and
// the ones that draw or propose something). A name that is not listed falls back to the raw tool name.
const TOOL_NAMES: Record<string, string> = {
  query_metric: "Sales metrics",
  get_orders: "Orders",
  search_products: "Products",
  get_inventory: "Inventory",
  get_customers: "Customers",
  describe_metrics: "Metric definitions",
  explain_gap: "Why the month missed plan",
  zero_sales_days: "Days with no sales",
  get_calendar: "Marketing calendar",
  get_notes: "Call notes",
  render_view: "Chart or table",
  remember: "Note for this brand",
  propose_action: "Proposed change",
  draft_landing_page: "Landing page draft",
};

export function toolLabel(name: string): string {
  return TOOL_NAMES[name] ?? name;
}
