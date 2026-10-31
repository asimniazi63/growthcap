// Admin GraphQL documents for the sync (API 2026-10). Read-only, and none asks for a name, email, phone or address.
// Page sizes keep each query under Shopify's cost limit of 1000 points. Measured on the real Solenne store (2026-10-31):
// 10 products request 326 points and 40 orders request 261 (the actual cost is about 65). A connection that overflows
// its page is an error, not a silent cut-off.

export const SYNC_PRODUCTS = `query SyncProducts($after: String) {
  products(first: 10, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id title handle status description tags
      variants(first: 25) {
        pageInfo { hasNextPage }
        nodes {
          id sku title price
          inventoryItem {
            unitCost { amount }
            inventoryLevels(first: 5) { nodes { location { id } quantities(names: ["available"]) { name quantity } } }
          }
        }
      }
    }
  }
}`;

const ORDER_FIELDS = `
  id name processedAt createdAt cancelledAt tags note discountCodes
  customer { id }
  totalDiscountsSet { shopMoney { amount } }
  totalShippingPriceSet { shopMoney { amount } }
  lineItems(first: 20) {
    pageInfo { hasNextPage }
    nodes {
      id quantity
      variant { id product { id } }
      originalUnitPriceSet { shopMoney { amount } }
      discountAllocations { allocatedAmountSet { shopMoney { amount } } }
    }
  }
  refunds {
    id processedAt
    refundLineItems(first: 20) {
      pageInfo { hasNextPage }
      nodes { id quantity lineItem { id } subtotalSet { shopMoney { amount } } }
    }
  }`;

export const SYNC_ORDERS = `query SyncOrders($after: String) {
  orders(first: 40, after: $after, sortKey: PROCESSED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {${ORDER_FIELDS}
    }
  }
}`;

export const SYNC_ORDER = `query SyncOrder($id: ID!) {
  order(id: $id) {${ORDER_FIELDS}
  }
}`;
