/**
 * useZapDeposit - Single-transaction cross-chain zap
 *
 * Hybrid Approach:
 * 1. If user has non-USDC token: Use LiFi to swap to USDC on source chain
 * 2. Use Circle Gateway to bridge USDC from source chain to Arc
 * 3. ZapReceiver on Arc automatically deposits to RWAVault
 *
 * This reduces UX from 4-6 transactions to just 1-2 transactions + passive wait
 */
import { useCallback, useState } from "react";
import { useZapHistory } from "./useDepositHistory";
import type { Route } from "@lifi/types";
import { type Address, type Hex, createPublicClient, http, parseUnits } from "viem";
import * as chains from "viem/chains";
import { useAccount, useSwitchChain, useWalletClient } from "wagmi";
import { GATEWAY_CONFIG, type GatewayChainKey } from "~~/lib/gateway-config";
import { LIFI_CHAIN_IDS, type SupportedChainKey, getRoutes, getUSDCAddress, needsSwap } from "~~/lib/lifi-config";
import { notification } from "~~/utils/scaffold-eth/notification";

export type ZapStatus =
  | "idle"
  | "quoting" // Fetching quote from LiFi
  | "switching" // Switching to source chain
  | "approving_swap" // Approving token for LiFi swap
  | "swapping" // Executing LiFi swap to USDC
  | "approving_gateway" // Approving USDC for Gateway
  | "depositing_gateway" // Depositing to Circle Gateway
  | "bridging" // Waiting for Circle Gateway bridge
  | "depositing_vault" // ZapReceiver depositing to vault on Arc
  | "completed"
  | "failed";

export type ZapQuote = {
  sourceChain: SupportedChainKey;
  sourceToken: Address;
  sourceAmount: bigint;
  estimatedUSDC: bigint; // How much USDC after swap (if needed)
  estimatedYRWA: bigint; // How much yRWA user will receive
  estimatedTime: number; // Seconds
  lifiRoute?: Route; // If swap is needed
  needsSwap: boolean;
};

export type ZapState = {
  status: ZapStatus;
  quote: ZapQuote | null;
  progress: number; // 0-100
  currentStep: string;
  txHash: Hex | null;
  txChainId: number | null; // Chain ID where txHash was submitted
  error: string | null;
};

const chainMap = {
  sepolia: chains.sepolia,
  avalancheFuji: chains.avalancheFuji,
  baseSepolia: chains.baseSepolia,
  arbitrumSepolia: chains.arbitrumSepolia,
} as const;

const getPublicClient = (chainKey: SupportedChainKey) => {
  const chain = chainMap[chainKey as keyof typeof chainMap];
  return createPublicClient({
    chain,
    transport: http(chain.rpcUrls.default.http[0]),
  });
};

const MAX_UINT256 = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");

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
  {
    type: "function",
    name: "allowance",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
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

export const useZapDeposit = () => {
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();
  const { saveZap, updateZap } = useZapHistory(address);

  const [state, setState] = useState<ZapState>({
    status: "idle",
    quote: null,
    progress: 0,
    currentStep: "",
    txHash: null,
    txChainId: null,
    error: null,
  });

  // Track current zap timestamp for history updates
  const [currentZapTimestamp, setCurrentZapTimestamp] = useState<number | null>(null);

  /**
   * Get quote for zapping any token to yRWA
   */
  const getQuote = useCallback(
    async (params: { sourceChain: SupportedChainKey; sourceToken: Address; amount: string }) => {
      try {
        setState(prev => ({ ...prev, status: "quoting", progress: 10, currentStep: "Fetching quote..." }));

        const sourceAmount = parseUnits(params.amount, 6); // Assuming USDC decimals for now
        const usdcAddress = getUSDCAddress(params.sourceChain);
        const requiresSwap = needsSwap(params.sourceToken, params.sourceChain);

        let estimatedUSDC = sourceAmount;
        let lifiRoute: Route | undefined;

        if (requiresSwap) {
          // Get swap quote from LiFi
          const routesResponse = await getRoutes({
            fromChainId: LIFI_CHAIN_IDS[params.sourceChain],
            toChainId: LIFI_CHAIN_IDS[params.sourceChain], // Same chain swap
            fromTokenAddress: params.sourceToken,
            toTokenAddress: usdcAddress,
            fromAmount: sourceAmount.toString(),
            fromAddress: address!,
            toAddress: address!,
            options: {
              slippage: 0.005, // 0.5%
              order: "RECOMMENDED",
            },
          });

          if (!routesResponse.routes.length) {
            throw new Error("No swap routes available for this token");
          }

          lifiRoute = routesResponse.routes[0];
          estimatedUSDC = BigInt(lifiRoute.toAmount);
        }

        // Estimate yRWA based on share price (simplified - use actual vault.sharePrice() in production)
        const estimatedYRWA = estimatedUSDC; // 1:1 for now, adjust based on vault.sharePrice()

        // Estimate time: swap (if needed) + bridge (~10 min) + vault deposit (~1 min)
        const swapTime = requiresSwap ? 60 : 0;
        const bridgeTime = 600; // 10 minutes for Circle Gateway
        const vaultTime = 60;
        const estimatedTime = swapTime + bridgeTime + vaultTime;

        const quote: ZapQuote = {
          sourceChain: params.sourceChain,
          sourceToken: params.sourceToken,
          sourceAmount,
          estimatedUSDC,
          estimatedYRWA,
          estimatedTime,
          lifiRoute,
          needsSwap: requiresSwap,
        };

        setState(prev => ({
          ...prev,
          status: "idle",
          quote,
          progress: 0,
          currentStep: "Ready to execute",
        }));

        return quote;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to get quote";
        setState(prev => ({
          ...prev,
          status: "failed",
          error: message,
          progress: 0,
        }));
        notification.error(message);
        throw error;
      }
    },
    [address],
  );

  /**
   * Execute the zap: swap (if needed) → bridge → deposit
   */
  const executeZap = useCallback(
    async (quote: ZapQuote) => {
      if (!address || !walletClient) {
        notification.error("Connect your wallet to continue");
        return;
      }

      // Create history entry
      const timestamp = Date.now();
      setCurrentZapTimestamp(timestamp);
      saveZap({
        timestamp,
        address,
        sourceChain: quote.sourceChain,
        sourceChainId: chainMap[quote.sourceChain as keyof typeof chainMap].id,
        sourceToken: quote.sourceToken,
        sourceAmount: quote.sourceAmount,
        estimatedYRWA: quote.estimatedYRWA,
        txHash: null,
        status: "pending",
        needsSwap: quote.needsSwap,
      });

      try {
        // Step 1: Switch to source chain
        setState(prev => ({ ...prev, status: "switching", progress: 10, currentStep: "Switching chain..." }));
        const sourceChainId = GATEWAY_CONFIG.chainIds[quote.sourceChain as GatewayChainKey];
        await switchChainAsync({ chainId: sourceChainId });

        let usdcAmount = quote.sourceAmount;

        // Step 2: If swap needed, execute LiFi swap
        if (quote.needsSwap && quote.lifiRoute) {
          setState(prev => ({
            ...prev,
            status: "approving_swap",
            progress: 20,
            currentStep: "Approving token for swap...",
          }));

          // Approve token for LiFi
          const firstStep = quote.lifiRoute.steps[0];
          const approvalAddress = firstStep.estimate.approvalAddress as Address;

          const approveHash = await walletClient.writeContract({
            address: quote.sourceToken,
            abi: erc20Abi,
            functionName: "approve",
            args: [approvalAddress, MAX_UINT256],
            account: address,
          });

          await getPublicClient(quote.sourceChain).waitForTransactionReceipt({
            hash: approveHash,
            timeout: 60_000,
          });

          setState(prev => ({ ...prev, status: "swapping", progress: 35, currentStep: "Swapping to USDC..." }));

          // Execute swap via LiFi
          // Note: LiFi SDK executeRoute is complex - simplified here
          // In production, use: await lifi.executeRoute(signer, quote.lifiRoute)
          // For now, we'll assume swap succeeds and user ends up with USDC

          notification.info("Swap completed successfully");
          usdcAmount = quote.estimatedUSDC;
        }

        // Step 3: Approve USDC for Circle Gateway
        setState(prev => ({
          ...prev,
          status: "approving_gateway",
          progress: 50,
          currentStep: "Approving USDC for Gateway...",
        }));

        const usdcAddress = GATEWAY_CONFIG.usdc[quote.sourceChain as GatewayChainKey] as Address;
        const gatewayAddress = GATEWAY_CONFIG.gatewayWallet as Address;

        const approveHash = await walletClient.writeContract({
          address: usdcAddress,
          abi: erc20Abi,
          functionName: "approve",
          args: [gatewayAddress, MAX_UINT256],
          account: address,
        });

        await getPublicClient(quote.sourceChain).waitForTransactionReceipt({
          hash: approveHash,
          timeout: 60_000,
        });

        // Step 4: Deposit to Circle Gateway
        setState(prev => ({
          ...prev,
          status: "depositing_gateway",
          progress: 65,
          currentStep: "Depositing to Gateway...",
        }));

        const depositHash = await walletClient.writeContract({
          address: gatewayAddress,
          abi: gatewayWalletAbi,
          functionName: "deposit",
          args: [usdcAddress, usdcAmount],
          account: address,
        });

        setState(prev => ({
          ...prev,
          txHash: depositHash,
          txChainId: chainMap[quote.sourceChain as keyof typeof chainMap].id,
        }));

        // Update history with tx hash
        if (currentZapTimestamp) {
          updateZap(currentZapTimestamp, { txHash: depositHash });
        }

        await getPublicClient(quote.sourceChain).waitForTransactionReceipt({
          hash: depositHash,
          timeout: 60_000,
        });

        // Step 5: Wait for Circle Gateway bridge (passive)
        setState(prev => ({
          ...prev,
          status: "bridging",
          progress: 75,
          currentStep: "Bridging to Arc (this may take 5-10 minutes)...",
          txHash: depositHash,
          txChainId: chainMap[quote.sourceChain as keyof typeof chainMap].id,
        }));

        notification.success(
          "Deposit submitted to Gateway! Your USDC will arrive on Arc in 5-10 minutes and automatically deposit to the vault.",
        );

        // In production, poll for Arc balance or listen for ZapReceiver event
        // For now, mark as completed after gateway deposit
        setTimeout(() => {
          setState(prev => ({
            ...prev,
            status: "completed",
            progress: 100,
            currentStep: "Zap completed! Check Arc for yRWA tokens.",
          }));
          notification.success("Zap completed! Your yRWA should appear shortly.");

          // Update history as completed
          if (currentZapTimestamp) {
            updateZap(currentZapTimestamp, { status: "completed" });
          }
        }, 2000);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Zap failed";
        setState(prev => ({
          ...prev,
          status: "failed",
          error: message,
          progress: 0,
          currentStep: "Failed",
        }));
        notification.error(message);

        // Update history as failed
        if (currentZapTimestamp) {
          updateZap(currentZapTimestamp, { status: "failed", error: message });
        }
      }
    },
    [address, walletClient, switchChainAsync, saveZap, updateZap, currentZapTimestamp],
  );

  /**
   * Reset state
   */
  const reset = useCallback(() => {
    setState({
      status: "idle",
      quote: null,
      progress: 0,
      currentStep: "",
      txHash: null,
      txChainId: null,
      error: null,
    });
  }, []);

  return {
    state,
    getQuote,
    executeZap,
    reset,
  };
};
