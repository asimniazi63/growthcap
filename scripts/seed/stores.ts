import type { StoreKey } from "./types.js";

export interface StoreConfig {
  key: StoreKey;
  name: string;
  timezone: string;
  currency: "USD";
  from: string; // first day of data
  targetOrders: number; // about
  shopDomainEnv: string; // env variable holding the myshopify domain
}

export const STORES: Record<StoreKey, StoreConfig> = {
  solenne: {
    key: "solenne",
    name: "Solenne",
    timezone: "America/New_York",
    currency: "USD",
    from: "2025-09-01",
    targetOrders: 1000,
    shopDomainEnv: "SOLENNE_SHOP_DOMAIN",
  },
  tidepool: {
    key: "tidepool",
    name: "Tidepool Baby",
    timezone: "America/Los_Angeles",
    currency: "USD",
    from: "2025-11-01",
    targetOrders: 100,
    shopDomainEnv: "TIDEPOOL_SHOP_DOMAIN",
  },
};

export const SEED = 42;
export const AS_OF = "2026-10-31";
export const API_VERSION = "2026-10";
export const FICTIONAL_LINE =
  "FICTIONAL SAMPLE: not a Growth Capital document. All brands, people and figures are invented.";
