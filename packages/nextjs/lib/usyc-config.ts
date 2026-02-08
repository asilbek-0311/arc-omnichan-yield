import { GATEWAY_CONFIG } from "~~/lib/gateway-config";

export const USYC_CONFIG = {
  chainId: GATEWAY_CONFIG.destinationChainId,
  usdc: process.env.NEXT_PUBLIC_USDC_ARC_TESTNET as `${string}`,
  usycToken: "0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C",
  teller: "0x9fdF14c5B14173D74C08Af27AebFf39240dC105A",
  entitlements: "0xcc205224862c7641930c87679e98999d23c26113",
} as const;
