export type GatewayChainKey = "sepolia" | "avalancheFuji" | "baseSepolia" | "arbitrumSepolia";

export const GATEWAY_CONFIG = {
  gatewayWallet: process.env.NEXT_PUBLIC_GATEWAY_WALLET as `${string}`,
  gatewayMinter: process.env.NEXT_PUBLIC_GATEWAY_MINTER as `${string}`,
  apiUrl: process.env.NEXT_PUBLIC_GATEWAY_API_URL!,
  destinationChainId: Number(process.env.NEXT_PUBLIC_DESTINATION_CHAIN_ID),
  destinationUsdc: process.env.NEXT_PUBLIC_USDC_ARC_TESTNET as `${string}`,
  zapReceiverAddress: process.env.NEXT_PUBLIC_ZAP_RECEIVER_ADDRESS as `${string}`,
  usdc: {
    sepolia: process.env.NEXT_PUBLIC_USDC_SEPOLIA as `${string}`,
    avalancheFuji: process.env.NEXT_PUBLIC_USDC_AVAX_FUJI as `${string}`,
    baseSepolia: process.env.NEXT_PUBLIC_USDC_BASE_SEPOLIA as `${string}`,
    arbitrumSepolia: process.env.NEXT_PUBLIC_USDC_ARBITRUM_SEPOLIA as `${string}`,
  },
  domains: {
    sepolia: 0,
    avalancheFuji: 1,
    baseSepolia: 6,
    arbitrumSepolia: 3,
    arcTestnet: 5, // Arc testnet domain ID - verify with Circle Gateway docs
  },
  chainIds: {
    sepolia: 11155111,
    avalancheFuji: 43113,
    baseSepolia: 84532,
    arbitrumSepolia: 421614,
  },
} as const;

export const GATEWAY_CHAINS: GatewayChainKey[] = ["sepolia", "arbitrumSepolia", "baseSepolia", "avalancheFuji"];
