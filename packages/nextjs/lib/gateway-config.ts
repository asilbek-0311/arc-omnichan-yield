export type GatewayChainKey = "sepolia" | "avalancheFuji" | "baseSepolia" | "arbitrumSepolia";

export const GATEWAY_CONFIG = {
  gatewayWallet: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
  gatewayMinter: "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B",
  apiUrl: "https://gateway-api-testnet.circle.com/v1",
  destinationChainId: 5042002,
  destinationUsdc: "0x3600000000000000000000000000000000000000",
  usdc: {
    sepolia: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    avalancheFuji: "0x5425890298aed601595a70ab815c96711a31bc65",
    baseSepolia: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    arbitrumSepolia: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
  },
  domains: {
    sepolia: 0,
    avalancheFuji: 1,
    baseSepolia: 6,
    arbitrumSepolia: 3,
  },
  chainIds: {
    sepolia: 11155111,
    avalancheFuji: 43113,
    baseSepolia: 84532,
    arbitrumSepolia: 421614,
  },
} as const;

export const GATEWAY_CHAINS: GatewayChainKey[] = ["sepolia", "arbitrumSepolia", "baseSepolia", "avalancheFuji"];
