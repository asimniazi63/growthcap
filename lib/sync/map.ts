import { createHash } from "node:crypto";
import { localDate } from "../clock";

// Turns Admin GraphQL nodes into table rows. The paged sync and the orders/create handler both use it, so a
// synced order and a webhook order land in the same shape. Nothing personal is read, let alone stored.

interface MoneyBag {
  shopMoney: { amount: string };
}

interface Paged<T> {
  nodes: T[];
  pageInfo: { hasNextPage: boolean };
}

export interface OrderNode {
  id: string;
  name: string;
  processedAt: string | null;
  createdAt: string;
  cancelledAt: string | null;
  tags: string[];
  note: string | null;
  discountCodes: string[];
  customer: { id: string } | null;
  totalDiscountsSet: MoneyBag;
  totalShippingPriceSet: MoneyBag;
  lineItems: Paged<{
    id: string;
    quantity: number;
    variant: { id: string; product: { id: string } | null } | null;
    originalUnitPriceSet: MoneyBag;
    discountAllocations: { allocatedAmountSet: MoneyBag }[];
  }>;
  refunds: {
    id: string;
    processedAt: string | null;
    refundLineItems: Paged<{ id: string; quantity: number; lineItem: { id: string } | null; subtotalSet: MoneyBag }>;
  }[];
}

export interface ProductNode {
  id: string;
  title: string;
  handle: string;
  status: string;
  description: string;
  tags: string[];
  variants: Paged<{
    id: string;
    sku: string | null;
    title: string;
    price: string;
    inventoryItem: {
      unitCost: { amount: string } | null;
      inventoryLevels: { nodes: { location: { id: string }; quantities: { name: string; quantity: number }[] }[] };
    } | null;
  }>;
}

// Shopify sends decimals as strings. Parsed digit by digit, so no float ever touches a price.
export function moneyToCents(amount: string): number {
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(amount);
  if (!m) throw new Error(`Not a money amount: ${JSON.stringify(amount)}`);
  const cents = Number(m[2]) * 100 + Number((m[3] ?? "").padEnd(2, "0"));
  return m[1] ? -cents : cents;
}

// A customer is never stored by their Shopify id: CUST_ plus a hash of the tenant and that id. The same shopper
// gets different pseudonyms in different tenants, so rows can't be joined across brands.
export function pseudonymFor(tenantId: string, shopifyCustomerId: string): string {
  return `CUST_${createHash("sha256").update(`${tenantId}:${shopifyCustomerId}`).digest("hex").slice(0, 16)}`;
}

const cents = (bag: MoneyBag) => moneyToCents(bag.shopMoney.amount);

export function mapOrder(tenantId: string, timezone: string, node: OrderNode) {
  if (node.lineItems.pageInfo.hasNextPage) throw new Error(`Order ${node.name} has more line items than one page; not stored partly`);

  // processedAt is the date the order counts on. Seeded orders get the import time as createdAt.
  const processedAt = new Date(node.processedAt ?? node.createdAt);
  const customerId = node.customer ? pseudonymFor(tenantId, node.customer.id) : null;
  const channelTag = node.tags.find((t) => t.startsWith("channel:"));

  const lines = node.lineItems.nodes.map((l) => ({
    tenantId,
    id: l.id,
    orderId: node.id,
    variantId: l.variant?.id ?? null,
    productId: l.variant?.product?.id ?? null,
    quantity: l.quantity,
    unitPriceCents: cents(l.originalUnitPriceSet),
    discountCents: l.discountAllocations.reduce((s, a) => s + cents(a.allocatedAmountSet), 0),
  }));

  const order = {
    tenantId,
    id: node.id,
    name: node.name,
    processedAt,
    localDate: localDate(processedAt.getTime(), timezone),
    customerId,
    grossCents: lines.reduce((s, l) => s + l.quantity * l.unitPriceCents, 0),
    discountCents: cents(node.totalDiscountsSet),
    shippingCents: cents(node.totalShippingPriceSet),
    discountCode: node.discountCodes[0] ?? null,
    channel: channelTag ? channelTag.slice("channel:".length) : "unknown",
    tags: node.tags,
    note: node.note,
    cancelledAt: node.cancelledAt ? new Date(node.cancelledAt) : null,
  };

  const refunds = node.refunds.map((r) => {
    if (r.refundLineItems.pageInfo.hasNextPage) throw new Error(`Refund ${r.id} has more lines than one page; not stored partly`);
    const refundLines = r.refundLineItems.nodes.map((rl) => ({
      tenantId,
      id: rl.id,
      refundId: r.id,
      orderLineId: rl.lineItem?.id ?? null,
      quantity: rl.quantity,
      subtotalCents: cents(rl.subtotalSet),
    }));
    const at = new Date(r.processedAt ?? node.createdAt);
    return {
      refund: {
        tenantId,
        id: r.id,
        orderId: node.id,
        processedAt: at,
        localDate: localDate(at.getTime(), timezone),
        amountCents: refundLines.reduce((s, l) => s + l.subtotalCents, 0),
      },
      lines: refundLines,
    };
  });

  return { order, lines, refunds, customer: customerId ? { tenantId, id: customerId, firstSeenAt: processedAt } : null };
}

export function mapProduct(tenantId: string, node: ProductNode) {
  if (node.variants.pageInfo.hasNextPage) throw new Error(`Product ${node.title} has more variants than one page; not stored partly`);
  const variants = node.variants.nodes.map((v) => ({
    tenantId,
    id: v.id,
    productId: node.id,
    sku: v.sku ?? "",
    title: v.title,
    priceCents: moneyToCents(v.price),
    unitCostCents: v.inventoryItem?.unitCost ? moneyToCents(v.inventoryItem.unitCost.amount) : null,
  }));
  const levels = node.variants.nodes.flatMap((v) =>
    (v.inventoryItem?.inventoryLevels.nodes ?? []).map((lv) => ({
      tenantId,
      variantId: v.id,
      locationId: lv.location.id,
      available: lv.quantities.find((q) => q.name === "available")?.quantity ?? 0,
    })),
  );
  return {
    product: { tenantId, id: node.id, title: node.title, handle: node.handle, status: node.status, description: node.description, tags: node.tags },
    variants,
    levels,
  };
}
