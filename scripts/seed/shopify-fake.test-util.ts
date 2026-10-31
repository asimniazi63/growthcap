// A fake Shopify for the loader tests: answers the token endpoint and every operation the loader sends.
// Operations are recognised by their name (the documents are all named Seed...).
export interface FakeCall {
  op: string;
  variables: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  query: string;
}

interface FakeOrder {
  id: string;
  sourceIdentifier: string;
  lineItems: { nodes: { id: string; variant: { id: string } }[] };
  transactions: { id: string; kind: string }[];
}

export interface FakeOptions {
  existingOrders?: string[]; // source identifiers already in the shop (created before a crash)
  failOrders?: string[]; // source identifiers that come back with userErrors
  throttleOrders?: Record<string, number>; // source identifier -> how many times Shopify says "Too many attempts" before it accepts the order
  failRefunds?: boolean;
}

export function createFakeShopify(opts: FakeOptions = {}) {
  const calls: FakeCall[] = [];
  let n = 100;
  const gid = (type: string) => `gid://shopify/${type}/${++n}`;
  const orders = new Map<string, FakeOrder>();
  const refundsByOrder = new Map<string, { id: string; processedAt: string }[]>();
  const throttled = new Map(Object.entries(opts.throttleOrders ?? {}));
  let tokenRequests = 0;

  const makeOrder = (sourceIdentifier: string, variantIds: string[]): FakeOrder => ({
    id: gid("Order"),
    sourceIdentifier,
    lineItems: { nodes: variantIds.map((v) => ({ id: gid("LineItem"), variant: { id: v } })) },
    transactions: [{ id: gid("OrderTransaction"), kind: "SALE" }],
  });
  for (const id of opts.existingOrders ?? []) orders.set(id, makeOrder(id, ["gid://shopify/ProductVariant/1"]));

  const respond = (op: string, v: Record<string, any>): unknown => { // eslint-disable-line @typescript-eslint/no-explicit-any
    switch (op) {
      case "SeedLocationsList":
        return { locations: { nodes: [{ id: "gid://shopify/Location/1", name: "Shop location" }] } };
      case "SeedLocationAdd":
        return { locationAdd: { location: { id: gid("Location"), name: v.input.name }, userErrors: [] } };
      case "SeedCollectionLookup":
        return { collections: { nodes: [] } };
      case "SeedCollectionCreate":
        return { collectionCreate: { collection: { id: gid("Collection") }, userErrors: [] } };
      case "SeedProductLookup":
        return { productByIdentifier: null };
      case "SeedProductSet":
        return {
          productSet: {
            product: {
              id: gid("Product"),
              variants: {
                nodes: v.input.variants.map((x: { sku: string }) => ({
                  id: gid("ProductVariant"),
                  sku: x.sku,
                  inventoryItem: { id: gid("InventoryItem") },
                })),
              },
            },
            userErrors: [],
          },
        };
      case "SeedDiscountLookup":
        return { codeDiscountNodeByCode: null };
      case "SeedDiscountCreate":
        return { discountCodeBasicCreate: { codeDiscountNode: { id: gid("DiscountCodeNode") }, userErrors: [] } };
      case "SeedCustomerLookup":
        return { customerByIdentifier: null };
      case "SeedCustomerCreate":
        return { customerCreate: { customer: { id: gid("Customer") }, userErrors: [] } };
      case "SeedOrderLookup": {
        const found = orders.get(String(v.q).replace("source_identifier:", ""));
        return { orders: { nodes: found ? [found] : [] } };
      }
      case "SeedOrderCreate": {
        const src = v.order.sourceIdentifier as string;
        const throttledLeft = throttled.get(src) ?? 0;
        if (throttledLeft > 0) {
          throttled.set(src, throttledLeft - 1);
          return { orderCreate: { order: null, userErrors: [{ field: null, message: "Too many attempts. Please try again later." }] } };
        }
        if (opts.failOrders?.includes(src)) {
          return { orderCreate: { order: null, userErrors: [{ field: ["order", "processedAt"], message: "is invalid" }] } };
        }
        const order = makeOrder(src, v.order.lineItems.map((l: { variantId: string }) => l.variantId));
        orders.set(src, order);
        return { orderCreate: { order, userErrors: [] } };
      }
      case "SeedRefundLookup":
        return { order: { refunds: refundsByOrder.get(v.id) ?? [] } };
      case "SeedRefundCreate": {
        if (opts.failRefunds) return { refundCreate: { refund: null, userErrors: [{ field: ["input"], message: "cannot refund" }] } };
        const refund = { id: gid("Refund"), processedAt: v.input.processedAt as string };
        refundsByOrder.set(v.input.orderId, [...(refundsByOrder.get(v.input.orderId) ?? []), refund]);
        return { refundCreate: { refund, userErrors: [] } };
      }
      case "SeedInventorySet":
        return { inventorySetQuantities: { inventoryAdjustmentGroup: { id: gid("InventoryAdjustmentGroup") }, userErrors: [] } };
      default:
        throw new Error(`fake Shopify: unknown operation ${op}`);
    }
  };

  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/admin/oauth/access_token")) {
      tokenRequests++;
      return new Response(JSON.stringify({ access_token: "fake-token", scope: "write_orders", expires_in: 86399 }), { status: 200 });
    }
    const body = JSON.parse(String(init?.body)) as { query: string; variables?: Record<string, unknown> };
    const op = /(?:query|mutation) (Seed\w+)/.exec(body.query)?.[1] ?? "unknown";
    const variables = body.variables ?? {};
    calls.push({ op, variables, query: body.query });
    return new Response(JSON.stringify({ data: respond(op, variables) }), { status: 200 });
  }) as typeof fetch;

  return {
    fetch: fetchFn,
    calls,
    orders,
    count: (op: string) => calls.filter((c) => c.op === op).length,
    get tokenRequests() {
      return tokenRequests;
    },
  };
}
