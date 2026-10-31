// GraphQL documents for Admin API 2026-10. Each is named Seed... so logs and the test fake can recognise it.
// refundCreate and inventorySetQuantities need an @idempotent key, so their documents are built per call.

export const LOCATIONS_LIST = `query SeedLocationsList { locations(first: 50) { nodes { id name } } }`;

export const LOCATION_ADD = `mutation SeedLocationAdd($input: LocationAddInput!) {
  locationAdd(input: $input) { location { id name } userErrors { field message } }
}`;

export const COLLECTION_LOOKUP = `query SeedCollectionLookup($q: String!) { collections(first: 1, query: $q) { nodes { id } } }`;

export const COLLECTION_CREATE = `mutation SeedCollectionCreate($collection: CollectionCreateInput!) {
  collectionCreate(collection: $collection) { collection { id } userErrors { field message } }
}`;

export const PRODUCT_LOOKUP = `query SeedProductLookup($handle: String!) {
  productByIdentifier(identifier: { handle: $handle }) { id variants(first: 100) { nodes { id sku inventoryItem { id } } } }
}`;

export const PRODUCT_SET = `mutation SeedProductSet($input: ProductSetInput!) {
  productSet(input: $input, synchronous: true) {
    product { id variants(first: 100) { nodes { id sku inventoryItem { id } } } }
    userErrors { field message code }
  }
}`;

export const DISCOUNT_LOOKUP = `query SeedDiscountLookup($code: String!) { codeDiscountNodeByCode(code: $code) { id } }`;

export const DISCOUNT_CREATE = `mutation SeedDiscountCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
  discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) { codeDiscountNode { id } userErrors { field message code } }
}`;

export const CUSTOMER_LOOKUP = `query SeedCustomerLookup($email: String!) { customerByIdentifier(identifier: { emailAddress: $email }) { id } }`;

export const CUSTOMER_CREATE = `mutation SeedCustomerCreate($input: CustomerInput!) {
  customerCreate(input: $input) { customer { id } userErrors { field message } }
}`;

export const ORDER_LOOKUP = `query SeedOrderLookup($q: String!) {
  orders(first: 1, query: $q) {
    nodes { id sourceIdentifier lineItems(first: 250) { nodes { id variant { id } } } transactions { id kind } }
  }
}`;

export const ORDER_CREATE = `mutation SeedOrderCreate($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
  orderCreate(order: $order, options: $options) {
    order { id sourceIdentifier lineItems(first: 250) { nodes { id variant { id } } } transactions { id kind } }
    userErrors { field message }
  }
}`;

export const REFUND_LOOKUP = `query SeedRefundLookup($id: ID!) { order(id: $id) { refunds { id processedAt } } }`;

export const refundCreate = (key: string) => `mutation SeedRefundCreate($input: RefundInput!) {
  refundCreate(input: $input) @idempotent(key: "${key}") { refund { id processedAt } userErrors { field message } }
}`;

export const inventorySet = (key: string) => `mutation SeedInventorySet($input: InventorySetQuantitiesInput!) {
  inventorySetQuantities(input: $input) @idempotent(key: "${key}") {
    inventoryAdjustmentGroup { id }
    userErrors { field message }
  }
}`;
