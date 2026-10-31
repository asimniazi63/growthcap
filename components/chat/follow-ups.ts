// Follow-up questions under the newest answer. They are picked from the tools that ran, with no model call, and each one
// is a question the tools can answer today (query_metric, get_orders, search_products, get_inventory, get_customers,
// describe_metrics, explain_gap, zero_sales_days, get_calendar and the chart tool render_view).
const BY_TOOL: Record<string, readonly string[]> = {
  query_metric: ["Break this down by product", "Compare with the month before", "How does this compare with plan?", "Show this as a chart"],
  explain_gap: ["Which days had no sales?", "Propose a fix for next month"],
  zero_sales_days: ["How much stock is left?", "Show daily sales for these products"],
  get_inventory: ["Which of these sell fastest?", "Which of these have had no sales lately?"],
  search_products: ["How much stock is left of these?", "Which of these sold best last month?"],
  get_customers: ["How do new and returning customers compare?", "What is the average order value for returning customers?"],
  get_orders: ["Which of these orders were refunded?", "Show net sales for the same period"],
  describe_metrics: ["What were net sales last month?"],
  get_calendar: ["How did sales do while these ran?"],
};

const MAX_FOLLOW_UPS = 4;

// Takes one question from each tool in turn (the first tool's first, the second tool's first, and so on), so an answer
// that used two tools gets a mix. No duplicates, at most four. A tool with no entry (render_view, remember, propose_action)
// adds none.
export function followUps(toolNames: string[]): string[] {
  const lists = [...new Set(toolNames)].map((name) => (Object.hasOwn(BY_TOOL, name) ? BY_TOOL[name]! : []));
  const out: string[] = [];
  for (let i = 0; out.length < MAX_FOLLOW_UPS && lists.some((l) => i < l.length); i++) {
    for (const list of lists) {
      const q = list[i];
      if (q && !out.includes(q) && out.length < MAX_FOLLOW_UPS) out.push(q);
    }
  }
  return out;
}
