// Friendly names for every tool the assistant can call (the main agent's, the "why did we miss plan" investigators' and
// the ones that draw or propose something). A name that is not listed falls back to the raw tool name. The chat's tool
// chips, the proof drawer and the server's list of traced figures all read these.
const TOOL_NAMES: Record<string, string> = {
  query_metric: "Sales metrics",
  get_orders: "Orders",
  search_products: "Products",
  get_inventory: "Inventory",
  get_customers: "Customers",
  describe_metrics: "Metric definitions",
  explain_gap: "Why the month missed plan",
  zero_sales_days: "Days with no sales",
  get_zero_sales_days: "Days with no sales",
  get_calendar: "Marketing calendar",
  get_notes: "Call notes",
  get_cohorts: "Customer cohorts",
  get_unit_economics: "Unit economics",
  get_ebitda: "EBITDA",
  get_ebitda_scenario: "EBITDA what-if",
  get_promo_postmortem: "Promotion results",
  get_customer_segments: "Customer segments",
  get_launch_curves: "Launch curves",
  get_bundle_candidates: "Bundle candidates",
  get_action_items: "Action items",
  get_data_health: "Data health",
  run_growth_audit: "Growth audit",
  ask_document: "Plan document",
  render_view: "Chart or table",
  remember: "Note for this brand",
  propose_action: "Proposed change",
  draft_landing_page: "Landing page draft",
};

export function toolLabel(name: string): string {
  return TOOL_NAMES[name] ?? name;
}
