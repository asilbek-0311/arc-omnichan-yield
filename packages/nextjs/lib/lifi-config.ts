import { createConfig, getChains, getRoutes } from "@lifi/sdk";
import type { Chain, StaticToken } from "@lifi/types";

/**
 * LiFi SDK Configuration
 * Used for swapping any token to USDC on source chains before bridging to Arc via Circle Gateway
 */

// Initialize LiFi SDK config with API key for higher rate limits
createConfig({
  integrator: "arc-omnichain-yield",
  apiKey: process.env.NEXT_PUBLIC_LIFI_API_KEY,
});

// Re-export functions for use in hooks
export { getChains, getRoutes };

/**
 * Mapping of our supported chains to LiFi chain IDs
 * Note: LiFi SDK doesn't export testnet ChainId enums, so we use numeric IDs directly
 */
export const LIFI_CHAIN_IDS: Record<string, number> = {
  sepolia: 11155111, // Ethereum Sepolia
  baseSepolia: 84532, // Base Sepolia
  avalancheFuji: 43113, // Avalanche Fuji
} as const;

/**
 * USDC token configurations for each supported chain
 * These addresses match what's in our .env file
 */
export const USDC_TOKENS: Record<string, StaticToken> = {
  sepolia: {
    address: process.env.NEXT_PUBLIC_USDC_SEPOLIA!,
    chainId: LIFI_CHAIN_IDS.sepolia,
    symbol: "USDC",
    decimals: 6,
    name: "USD Coin",
    logoURI: "https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png",
  },
  baseSepolia: {
    address: process.env.NEXT_PUBLIC_USDC_BASE_SEPOLIA!,
    chainId: LIFI_CHAIN_IDS.baseSepolia,
    symbol: "USDC",
    decimals: 6,
    name: "USD Coin",
    logoURI: "https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png",
  },
  avalancheFuji: {
    address: process.env.NEXT_PUBLIC_USDC_AVAX_FUJI!,
    chainId: LIFI_CHAIN_IDS.avalancheFuji,
    symbol: "USDC",
    decimals: 6,
    name: "USD Coin",
    logoURI: "https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png",
  },
};

/**
 * Arc Testnet configuration
 * Note: LiFi doesn't natively support Arc, so we use hybrid approach:
 * 1. LiFi swaps any token → USDC on source chain (optional)
 * 2. Circle Gateway bridges USDC → Arc
 * 3. ZapReceiver deposits USDC → RWAVault on Arc
 */
export const ARC_TESTNET_CHAIN_ID = 5042002;

/**
 * Helper to check if LiFi supports a given chain
 */
export async function checkLiFiChainSupport(chainId: number): Promise<boolean> {
  try {
    const chains = await getChains();
    return chains.some((chain: Chain) => chain.id === chainId);
  } catch (error) {
    console.error("Error checking LiFi chain support:", error);
    return false;
  }
}

/**
 * Helper to get available tokens on a chain
 * Note: LiFi SDK v3 uses different API - simplified implementation
 */
export async function getAvailableStaticTokens(): Promise<StaticToken[]> {
  // ExtendedChain type doesn't have tokens property in v3
  // Use getStaticTokens() API instead if needed
  return [];
}

/**
 * Chain configuration for Circle Gateway
 * Maps our chain keys to Circle Gateway domain IDs
 */
export const CIRCLE_GATEWAY_DOMAINS: Record<string, number> = {
  sepolia: 0, // Ethereum Sepolia
  baseSepolia: 6, // Base Sepolia
  avalancheFuji: 1, // Avalanche Fuji
  arcTestnet: 26, // Arc Testnet (Circle Gateway)
} as const;

export type SupportedChainKey = keyof typeof LIFI_CHAIN_IDS;
export type CircleChainKey = keyof typeof CIRCLE_GATEWAY_DOMAINS;

/**
 * Helper to determine if we need to swap before bridging
 * @param tokenAddress StaticToken address to check
 * @param chainKey Source chain
 * @returns True if token needs to be swapped to USDC first
 */
export function needsSwap(tokenAddress: string, chainKey: SupportedChainKey): boolean {
  const usdcAddress = USDC_TOKENS[chainKey]?.address.toLowerCase();
  return tokenAddress.toLowerCase() !== usdcAddress;
}

/**
 * Get USDC address for a given chain
 */
export function getUSDCAddress(chainKey: SupportedChainKey): string {
  return USDC_TOKENS[chainKey]?.address || "";
}

/**
 * Validate that all required environment variables are set
 */
export function validateLiFiConfig(): { valid: boolean; missing: string[] } {
  const missing: string[] = [];

  const requiredEnvVars = [
    "NEXT_PUBLIC_USDC_SEPOLIA",
    "NEXT_PUBLIC_USDC_BASE_SEPOLIA",
    "NEXT_PUBLIC_USDC_AVAX_FUJI",
    "NEXT_PUBLIC_USDC_ARC_TESTNET",
    "NEXT_PUBLIC_GATEWAY_WALLET",
    "NEXT_PUBLIC_DESTINATION_CHAIN_ID",
  ];

  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      missing.push(envVar);
    }
  }

  return {
    valid: missing.length === 0,
    missing,
  };
}
