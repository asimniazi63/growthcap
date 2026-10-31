// Admin GraphQL documents for the sync (API 2026-10). Read-only, and none asks for a name, email, phone or address.
// Page sizes keep each query under Shopify's cost limit of 1000 points; a connection that still overflows is an error.

export const SYNC_PRODUCTS = `query SyncProducts($after: String) {
  products(first: 5, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id title handle status description tags
      variants(first: 25) {
        pageInfo { hasNextPage }
        nodes {
          id sku title price
          inventoryItem {
            unitCost { amount }
            inventoryLevels(first: 5) { nodes { location { id name } quantities(names: ["available"]) { name quantity } } }
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
  orders(first: 10, after: $after, sortKey: PROCESSED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {${ORDER_FIELDS}
    }
  }
}`;

export const SYNC_ORDER = `query SyncOrder($id: ID!) {
  order(id: $id) {${ORDER_FIELDS}
  }
}`;
