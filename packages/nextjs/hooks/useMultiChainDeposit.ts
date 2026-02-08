import { useCallback, useMemo, useState } from "react";
import { type Address, type Hex, createPublicClient, http } from "viem";
import * as chains from "viem/chains";
import { useAccount, useSwitchChain, useWalletClient } from "wagmi";
import { GATEWAY_CONFIG, type GatewayChainKey } from "~~/lib/gateway-config";
import { notification } from "~~/utils/scaffold-eth/notification";

const erc20Abi = [
  {
    type: "function",
    name: "approve",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
  },
] as const;

const gatewayWalletAbi = [
  {
    type: "function",
    name: "deposit",
    inputs: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

export type ChainDepositStatus = "idle" | "switching" | "approving" | "depositing" | "finality" | "ready" | "failed";

export type ChainDepositState = {
  chainKey: GatewayChainKey;
  chainId: number;
  amount: bigint;
  status: ChainDepositStatus;
  txHash?: Hex;
  error?: string;
};

type DepositRequest = {
  chainKey: GatewayChainKey;
  amount: bigint;
};

const chainMap = {
  sepolia: chains.sepolia,
  avalancheFuji: chains.avalancheFuji,
  baseSepolia: chains.baseSepolia,
} as const;

const getPublicClient = (chainKey: GatewayChainKey) => {
  const chain = chainMap[chainKey];
  return createPublicClient({
    chain,
    transport: http(chain.rpcUrls.default.http[0]),
  });
};

// MAX uint256 for infinite approval
const MAX_UINT256 = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");

export const useMultiChainDeposit = () => {
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();

  const [states, setStates] = useState<Record<GatewayChainKey, ChainDepositState>>({
    sepolia: { chainKey: "sepolia", chainId: GATEWAY_CONFIG.chainIds.sepolia, amount: 0n, status: "idle" },
    avalancheFuji: {
      chainKey: "avalancheFuji",
      chainId: GATEWAY_CONFIG.chainIds.avalancheFuji,
      amount: 0n,
      status: "idle",
    },
    baseSepolia: { chainKey: "baseSepolia", chainId: GATEWAY_CONFIG.chainIds.baseSepolia, amount: 0n, status: "idle" },
  });

  const updateState = useCallback((chainKey: GatewayChainKey, patch: Partial<ChainDepositState>) => {
    setStates(prev => ({
      ...prev,
      [chainKey]: { ...prev[chainKey], ...patch },
    }));
  }, []);

  const depositToChain = useCallback(
    async (req: DepositRequest) => {
      if (!address || !walletClient) return;

      const chainKey = req.chainKey;
      const usdcAddress = GATEWAY_CONFIG.usdc[chainKey] as Address;

      try {
        updateState(chainKey, { status: "switching", amount: req.amount, error: undefined });
        await switchChainAsync({ chainId: GATEWAY_CONFIG.chainIds[chainKey] });

        updateState(chainKey, { status: "approving" });
        const approveHash = await walletClient.writeContract({
          address: usdcAddress,
          abi: erc20Abi,
          functionName: "approve",
          args: [GATEWAY_CONFIG.gatewayWallet as Address, MAX_UINT256], // ← Approve unlimited
          account: address,
        });

        updateState(chainKey, { txHash: approveHash });
        await getPublicClient(chainKey).waitForTransactionReceipt({
          hash: approveHash,
          timeout: 60_000, // 1 min timeout
        });

        updateState(chainKey, { status: "depositing" });
        const depositHash = await walletClient.writeContract({
          address: GATEWAY_CONFIG.gatewayWallet as Address,
          abi: gatewayWalletAbi,
          functionName: "deposit",
          args: [usdcAddress, req.amount],
          account: address,
        });

        updateState(chainKey, { txHash: depositHash });
        await getPublicClient(chainKey).waitForTransactionReceipt({
          hash: depositHash,
          timeout: 60_000, // 1 min timeout
        });
        updateState(chainKey, { status: "finality", txHash: depositHash });
        notification.info(`${chainKey} deposit submitted. Waiting for gateway bridging.`);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Deposit failed";
        updateState(chainKey, { status: "failed", error: message });
        notification.error(`${chainKey} failed: ${message}`);
      }
    },
    [address, switchChainAsync, updateState, walletClient],
  );

  const startDeposit = useCallback(
    async (requests: DepositRequest[]) => {
      if (!address || !walletClient) {
        notification.error("Connect your wallet to continue.");
        return;
      }

      // Filter out zero amounts
      const validRequests = requests.filter(req => req.amount > 0n);

      // Execute all chains in parallel
      await Promise.allSettled(validRequests.map(req => depositToChain(req)));
    },
    [address, depositToChain, walletClient],
  );

  const summary = useMemo(() => Object.values(states), [states]);

  return { states, summary, startDeposit, updateState };
};
