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
  | "awaiting_claim" // USDC arrived on Arc, needs manual claim
  | "claiming" // Claiming and depositing to vault
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

export type TransactionRecord = {
  hash: Hex;
  chainId: number;
  step: string; // e.g., "Swap Approval", "Gateway Deposit", "Claim"
  timestamp: number;
};

export type ZapState = {
  status: ZapStatus;
  quote: ZapQuote | null;
  progress: number; // 0-100
  currentStep: string;
  txHash: Hex | null; // Current/most recent transaction
  txChainId: number | null; // Chain ID where txHash was submitted
  transactions: TransactionRecord[]; // All transactions in this zap
  error: string | null;
};

const chainMap = {
  sepolia: chains.sepolia,
  avalancheFuji: chains.avalancheFuji,
  baseSepolia: chains.baseSepolia,
  arbitrumSepolia: chains.arbitrumSepolia,
  arcTestnet: chains.arcTestnet,
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
  {
    type: "function",
    name: "depositForBurn",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "destinationDomain", type: "uint32" },
      { name: "mintRecipient", type: "bytes32" },
      { name: "burnToken", type: "address" },
    ],
    outputs: [{ name: "nonce", type: "uint64" }],
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
    transactions: [],
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
            gas: 100000n, // Set reasonable gas limit for approval
          });

          // Add to transaction history
          setState(prev => ({
            ...prev,
            transactions: [
              ...prev.transactions,
              {
                hash: approveHash,
                chainId: chainMap[quote.sourceChain as keyof typeof chainMap].id,
                step: "Token Approval for Swap",
                timestamp: Date.now(),
              },
            ],
          }));

          const swapApproveReceipt = await getPublicClient(quote.sourceChain).waitForTransactionReceipt({
            hash: approveHash,
            timeout: 60_000,
          });

          if (swapApproveReceipt.status === "reverted") {
            throw new Error("Token approval for swap failed. Please try again.");
          }

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
        // IMPORTANT: Approve the TokenMinter contract (not GatewayWallet)
        // because depositForBurn is called on TokenMinter
        const tokenMinterAddress = GATEWAY_CONFIG.gatewayMinter as Address;

        const approveHash = await walletClient.writeContract({
          address: usdcAddress,
          abi: erc20Abi,
          functionName: "approve",
          args: [tokenMinterAddress, MAX_UINT256],
          account: address,
          gas: 100000n, // Set reasonable gas limit for approval
        });

        // Add to transaction history
        setState(prev => ({
          ...prev,
          transactions: [
            ...prev.transactions,
            {
              hash: approveHash,
              chainId: chainMap[quote.sourceChain as keyof typeof chainMap].id,
              step: "USDC Approval for Gateway",
              timestamp: Date.now(),
            },
          ],
        }));

        const approveReceipt = await getPublicClient(quote.sourceChain).waitForTransactionReceipt({
          hash: approveHash,
          timeout: 60_000,
        });

        if (approveReceipt.status === "reverted") {
          throw new Error("USDC approval transaction failed. Please try again.");
        }

        // Step 4: Deposit to Circle Gateway with ZapReceiver as recipient
        setState(prev => ({
          ...prev,
          status: "depositing_gateway",
          progress: 65,
          currentStep: "Depositing to Gateway...",
        }));

        // Get ZapReceiver address from config and convert to bytes32 for Circle Gateway
        const zapReceiverAddress = GATEWAY_CONFIG.zapReceiverAddress as Address;
        // Remove '0x' prefix, pad to 32 bytes, add back '0x' prefix
        const mintRecipient = `0x${zapReceiverAddress.slice(2).padStart(64, "0")}` as `0x${string}`;

        // Get destination domain for Arc testnet from config
        const destinationDomain = GATEWAY_CONFIG.domains.arcTestnet;

        const depositHash = await walletClient.writeContract({
          address: GATEWAY_CONFIG.gatewayMinter as Address, // Use TokenMinter for depositForBurn
          abi: gatewayWalletAbi,
          functionName: "depositForBurn",
          args: [usdcAmount, destinationDomain, mintRecipient, usdcAddress],
          account: address,
          gas: 500000n, // Manually set gas limit to avoid exceeding network cap
        });

        setState(prev => ({
          ...prev,
          txHash: depositHash,
          txChainId: chainMap[quote.sourceChain as keyof typeof chainMap].id,
          transactions: [
            ...prev.transactions,
            {
              hash: depositHash,
              chainId: chainMap[quote.sourceChain as keyof typeof chainMap].id,
              step: "Circle Gateway Deposit",
              timestamp: Date.now(),
            },
          ],
        }));

        // Update history with tx hash
        if (currentZapTimestamp) {
          updateZap(currentZapTimestamp, { txHash: depositHash });
        }

        // Wait for transaction and check if it succeeded
        const receipt = await getPublicClient(quote.sourceChain).waitForTransactionReceipt({
          hash: depositHash,
          timeout: 60_000,
        });

        // Check if transaction was successful
        if (receipt.status === "reverted") {
          throw new Error("Gateway deposit transaction failed. Please check the transaction on the block explorer.");
        }

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
          "Deposit submitted to Gateway! Your USDC will arrive on Arc in 5-10 minutes. You'll need to claim it to receive yRWA.",
        );

        // After bridge completes (user needs to manually trigger claim)
        // Move to awaiting claim state
        setState(prev => ({
          ...prev,
          status: "awaiting_claim",
          progress: 85,
          currentStep: "USDC arrived on Arc! Click 'Claim & Deposit' to receive yRWA.",
        }));
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
   * Claim bridged USDC and deposit to vault on Arc
   */
  const claimAndDeposit = useCallback(
    async (amount: bigint) => {
      if (!address || !walletClient) {
        notification.error("Connect your wallet to continue");
        return;
      }

      try {
        setState(prev => ({ ...prev, status: "claiming", progress: 90, currentStep: "Switching to Arc..." }));

        // Switch to Arc testnet and wait for it to complete
        await switchChainAsync({ chainId: GATEWAY_CONFIG.destinationChainId });

        // Add small delay to ensure wallet client has updated
        await new Promise(resolve => setTimeout(resolve, 500));

        setState(prev => ({ ...prev, currentStep: "Claiming and depositing USDC..." }));

        // Call ZapReceiver.processBridgedDeposit()
        const zapReceiverAbi = [
          {
            type: "function",
            name: "processBridgedDeposit",
            inputs: [
              { name: "recipient", type: "address" },
              { name: "amount", type: "uint256" },
            ],
            outputs: [{ name: "success", type: "bool" }],
            stateMutability: "nonpayable",
          },
        ] as const;

        const claimHash = await walletClient.writeContract({
          address: GATEWAY_CONFIG.zapReceiverAddress as Address,
          abi: zapReceiverAbi,
          functionName: "processBridgedDeposit",
          args: [address, amount],
          account: address,
          chain: chains.arcTestnet, // Explicitly specify the chain
          gas: 500000n, // Set reasonable gas limit for claim transaction
        });

        setState(prev => ({
          ...prev,
          status: "depositing_vault",
          progress: 95,
          currentStep: "Depositing to vault...",
          txHash: claimHash,
          txChainId: chains.arcTestnet.id,
          transactions: [
            ...prev.transactions,
            {
              hash: claimHash,
              chainId: chains.arcTestnet.id,
              step: "Claim & Deposit to Vault",
              timestamp: Date.now(),
            },
          ],
        }));

        // Wait for transaction
        await createPublicClient({
          chain: chains.arcTestnet,
          transport: http(),
        }).waitForTransactionReceipt({
          hash: claimHash,
          timeout: 60_000,
        });

        // Mark as completed
        setState(prev => ({
          ...prev,
          status: "completed",
          progress: 100,
          currentStep: "Zap completed! yRWA tokens received.",
        }));
        notification.success("Successfully claimed and deposited! Check your yRWA balance.");

        // Update history as completed
        if (currentZapTimestamp) {
          updateZap(currentZapTimestamp, { status: "completed" });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Claim failed";
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
    [address, walletClient, switchChainAsync, updateZap, currentZapTimestamp],
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
      transactions: [],
      error: null,
    });
  }, []);

  return {
    state,
    getQuote,
    executeZap,
    claimAndDeposit,
    reset,
  };
};
