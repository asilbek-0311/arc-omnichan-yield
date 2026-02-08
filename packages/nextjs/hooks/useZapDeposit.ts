/**
 * useZapDeposit - One-Click Cross-Chain Zap Hook
 *
 * Enables single-transaction deposits from any supported chain to Arc Omnichain Yield vault.
 *
 * ## Architecture
 *
 * **Hybrid Approach:**
 * 1. **Token Swap (Optional)**: Use LiFi to swap any token → USDC on source chain
 * 2. **Gateway Transfer**: Use Circle Gateway unified balance to move USDC → Arc
 * 3. **Auto-Deposit**: ZapReceiver on Arc deposits USDC → RWAVault
 * 4. **Receive yRWA**: User receives yRWA shares representing vault position
 *
 * **UX Improvement:**
 * - Traditional flow: 4-6 transactions (swap → approve → deposit → switch → wait → approve → deposit)
 * - Zap flow: 1-2 transactions + passive wait
 *
 * ## State Machine
 *
 * ```
 * idle → quoting → switching → [approving_swap → swapping] → approving_gateway →
 * depositing_gateway → signing_intent → transferring_gateway → minting_gateway →
 * depositing_vault → completed
 * ```
 *
 * **Status Descriptions:**
 * - `idle`: Initial state, no operation in progress
 * - `quoting`: Fetching swap route from LiFi
 * - `switching`: Switching to source chain
 * - `approving_swap`: Approving token for LiFi swap (optional)
 * - `swapping`: Executing LiFi swap to USDC (optional)
 * - `approving_gateway`: Approving USDC for GatewayWallet
 * - `depositing_gateway`: Depositing to GatewayWallet
 * - `signing_intent`: Signing burn intent (EIP-712)
 * - `transferring_gateway`: Submitting transfer to Gateway API
 * - `minting_gateway`: Minting USDC on Arc via GatewayMinter
 * - `completed`: Successfully minted yRWA
 * - `failed`: Error occurred, see error message
 *
 * ## Integration Points
 *
 * **Circle Gateway Unified Balance:**
 * - Deposits USDC into GatewayWallet on source chain
 * - Signs burn intent and submits to Gateway API
 * - Mints native USDC on Arc via GatewayMinter
 * - Domain IDs: Sepolia (0), Fuji (1), Base Sepolia (6), Arc (26)
 *
 * **LiFi Integration:**
 * - Multi-hop token swaps
 * - Best price routing across DEXs
 * - Optional - only if token != USDC
 *
 * **ZapReceiver Contract:**
 * - Receives USDC from Circle Gateway
 * - Approves and deposits to RWAVault
 * - Transfers yRWA shares to user
 * - Graceful failure handling with pendingDeposits
 *
 * ## Transaction Tracking
 *
 * All transactions are recorded with:
 * - Hash: Transaction hash
 * - ChainId: Network where tx was submitted
 * - Step: Human-readable step name
 * - Timestamp: Unix timestamp
 *
 * ## Error Handling
 *
 * **Transaction Verification:**
 * - All receipts checked for `status === "reverted"`
 * - Descriptive error messages for each failure scenario
 * - Failed zaps stored in history for recovery
 *
 * **Recovery Mechanisms:**
 * - If vault deposit fails: USDC stored in ZapReceiver.pendingDeposits
 * - Admin can use recoverFunds() for emergency recovery
 *
 * @module useZapDeposit
 */
import { useCallback, useState } from "react";
import { useZapHistory } from "./useDepositHistory";
import type { Route } from "@lifi/types";
import { type Address, type Hex, createPublicClient, http, maxUint256, pad, parseUnits, toHex } from "viem";
import * as chains from "viem/chains";
import { useAccount, useSwitchChain, useWalletClient } from "wagmi";
import { type TransferIntent, submitTransfer } from "~~/lib/gateway-api";
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
  | "depositing_gateway" // Depositing to GatewayWallet
  | "signing_intent" // Signing burn intent
  | "transferring_gateway" // Submitting transfer to Gateway API
  | "minting_gateway" // Minting on Arc via GatewayMinter
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

type TransferSpec = {
  version: bigint;
  sourceDomain: number;
  destinationDomain: number;
  sourceContract: Hex;
  destinationContract: Hex;
  sourceToken: Hex;
  destinationToken: Hex;
  sourceDepositor: Hex;
  destinationRecipient: Hex;
  sourceSigner: Hex;
  destinationCaller: Hex;
  value: bigint;
  salt: Hex;
  hookData: Hex;
};

type BurnIntent = {
  maxBlockHeight: bigint;
  maxFee: bigint;
  feeToken: Hex;
  sourceDomain: number;
  destinationDomain: number;
  spec: TransferSpec;
};

const addressToBytes32 = (address: Address): Hex => {
  return pad(address as Hex, { size: 32 });
};

const getRandomSalt = (): Hex => {
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return toHex(bytes);
  }
  const fallback = Array.from({ length: 32 }, () => Math.floor(Math.random() * 256));
  return toHex(new Uint8Array(fallback));
};

/**
 * Retry helper for Arc RPC endpoint instability
 * Uses exponential backoff: 2s → 4s → 8s
 */
async function retryTransaction<T>(fn: () => Promise<T>, maxRetries = 3, delayMs = 2000): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      // Check if it's an RPC error
      const isRpcError =
        error?.message?.includes("RPC endpoint") || error?.message?.includes("Requested resource not available");

      if (!isRpcError || attempt === maxRetries - 1) {
        throw error;
      }

      // Wait before retrying with exponential backoff
      const delay = delayMs * Math.pow(2, attempt);
      console.log(`RPC error detected, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
      notification.info(`RPC issue detected, retrying in ${delay / 1000}s...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError || new Error("Transaction failed after retries");
}

/**
 * Chain validation helper
 * Ensures user hasn't manually switched chains mid-zap
 */
async function ensureCorrectChain(walletClient: any, expectedChainId: number, chainName: string): Promise<void> {
  const currentChainId = await walletClient.getChainId();
  if (currentChainId !== expectedChainId) {
    throw new Error(
      `Wrong chain: expected ${chainName} (${expectedChainId}) but wallet is on chain ${currentChainId}. Please switch your wallet to ${chainName}.`,
    );
  }
}

const computeMaxFee = (amount: bigint, chainKey: GatewayChainKey): bigint => {
  const gasFeeMap: Record<GatewayChainKey, bigint> = {
    sepolia: 2_000_000n, // 2.00 USDC
    baseSepolia: 10_000n, // 0.01 USDC
    avalancheFuji: 20_000n, // 0.02 USDC
  };
  const gasFee = gasFeeMap[chainKey] ?? 0n;
  const transferFee = (amount * 5n) / 100_000n; // amount * 0.00005
  const baseFee = gasFee + transferFee;
  const buffer = (baseFee * 10n) / 100n; // +10%
  return baseFee + buffer;
};

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

const gatewayMinterAbi = [
  {
    type: "function",
    name: "gatewayMint",
    inputs: [
      { name: "attestationPayload", type: "bytes" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

/**
 * One-click cross-chain deposit hook for Arc Omnichain Yield
 *
 * @returns Object containing zap functions and state
 * @property {Function} getQuote - Fetch quote for zapping token to yRWA
 * @property {Function} executeZap - Execute full zap flow (swap + bridge + deposit)
 * @property {Function} reset - Reset hook state to idle
 * @property {ZapStatus} status - Current zap status (idle | quoting | swapping | etc.)
 * @property {ZapQuote | null} quote - Quote details (if available)
 * @property {number} progress - Progress percentage (0-100)
 * @property {string} currentStep - Human-readable current step
 * @property {Hex | null} txHash - Most recent transaction hash
 * @property {number | null} txChainId - Chain ID where txHash was submitted
 * @property {TransactionRecord[]} transactions - All transactions in this zap
 * @property {string | null} error - Error message (if failed)
 *
 * @example Basic Usage
 * ```tsx
 * const {
 *   getQuote,
 *   executeZap,
 *   status,
 *   progress,
 *   transactions,
 *   error
 * } = useZapDeposit();
 *
 * // 1. Get quote
 * const quote = await getQuote({
 *   sourceChain: "sepolia",
 *   sourceToken: "0x...", // Token address
 *   sourceAmount: parseUnits("10", 18), // 10 tokens
 *   recipient: userAddress,
 * });
 *
 * // 2. Execute zap
 * await executeZap(quote);
 *
 * // 3. Monitor progress
 * console.log(`Status: ${status}, Progress: ${progress}%`);
 * ```
 *
 * @example With Error Handling
 * ```tsx
 * try {
 *   const quote = await getQuote({...});
 *   if (quote.needsSwap) {
 *     console.log(`Swapping ${sourceToken} → USDC via LiFi`);
 *   }
 *   await executeZap(quote);
 * } catch (err) {
 *   console.error('Zap failed:', error);
 * }
 * ```
 *
 * @example Transaction Tracking
 * ```tsx
 * transactions.forEach(tx => {
 *   console.log(`${tx.step}: ${tx.hash} on chain ${tx.chainId}`);
 * });
 * ```
 */
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

        const usdcAmount = quote.sourceAmount;

        // Step 2: If swap needed, execute LiFi swap
        if (quote.needsSwap && quote.lifiRoute) {
          setState(prev => ({
            ...prev,
            status: "approving_swap",
            progress: 20,
            currentStep: "Approving token for swap...",
          }));

          // Validate we're on the correct source chain
          await ensureCorrectChain(walletClient, sourceChainId, quote.sourceChain);

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

          // TODO: LiFi swap execution not yet implemented
          // Currently only USDC deposits are supported
          // To enable multi-token deposits:
          // 1. Install @lifi/sdk
          // 2. Replace this error with: await lifi.executeRoute(signer, quote.lifiRoute)
          // 3. Add swap transaction verification (check receipt.status)
          // 4. Track swap hash in transactions array
          throw new Error(
            "Token swaps not yet supported. Please deposit USDC directly. Multi-token support coming soon.",
          );
        }

        // Step 3: Approve USDC for GatewayWallet
        setState(prev => ({
          ...prev,
          status: "approving_gateway",
          progress: 50,
          currentStep: "Approving USDC for Gateway...",
        }));

        // Validate we're still on the correct source chain
        await ensureCorrectChain(walletClient, sourceChainId, quote.sourceChain);

        const usdcAddress = GATEWAY_CONFIG.usdc[quote.sourceChain as GatewayChainKey] as Address;
        const gatewayWalletAddress = GATEWAY_CONFIG.gatewayWallet as Address;

        const approveHash = await walletClient.writeContract({
          address: usdcAddress,
          abi: erc20Abi,
          functionName: "approve",
          args: [gatewayWalletAddress, MAX_UINT256],
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

        // Step 4: Deposit to GatewayWallet
        setState(prev => ({
          ...prev,
          status: "depositing_gateway",
          progress: 65,
          currentStep: "Depositing to Gateway Wallet...",
        }));

        // Validate we're still on the correct source chain before deposit
        await ensureCorrectChain(walletClient, sourceChainId, quote.sourceChain);

        const depositHash = await walletClient.writeContract({
          address: GATEWAY_CONFIG.gatewayWallet as Address,
          abi: gatewayWalletAbi,
          functionName: "deposit",
          args: [usdcAddress, usdcAmount],
          account: address,
          gas: 300000n,
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
              step: "Gateway Wallet Deposit",
              timestamp: Date.now(),
            },
          ],
        }));

        // Update history with tx hash
        if (currentZapTimestamp) {
          updateZap(currentZapTimestamp, { txHash: depositHash });
        }

        const depositReceipt = await getPublicClient(quote.sourceChain).waitForTransactionReceipt({
          hash: depositHash,
          timeout: 60_000,
        });

        if (depositReceipt.status === "reverted") {
          throw new Error("Gateway wallet deposit failed. Please check the transaction on the block explorer.");
        }

        // Step 5: Build and sign burn intent
        setState(prev => ({
          ...prev,
          status: "signing_intent",
          progress: 75,
          currentStep: "Signing burn intent...",
        }));

        const destinationDomain = GATEWAY_CONFIG.domains.arcTestnet;
        const sourceDomain = GATEWAY_CONFIG.domains[quote.sourceChain as GatewayChainKey];
        const burnIntent: BurnIntent = {
          maxBlockHeight: maxUint256,
          maxFee: computeMaxFee(usdcAmount, quote.sourceChain as GatewayChainKey),
          feeToken: addressToBytes32(usdcAddress), // Fee paid in USDC
          sourceDomain,
          destinationDomain,
          spec: {
            version: 1n,
            sourceDomain,
            destinationDomain,
            sourceContract: addressToBytes32(GATEWAY_CONFIG.gatewayWallet as Address),
            destinationContract: addressToBytes32(GATEWAY_CONFIG.gatewayMinter as Address),
            sourceToken: addressToBytes32(usdcAddress),
            destinationToken: addressToBytes32(GATEWAY_CONFIG.destinationUsdc as Address),
            sourceDepositor: addressToBytes32(address),
            destinationRecipient: addressToBytes32(GATEWAY_CONFIG.zapReceiverAddress as Address),
            sourceSigner: addressToBytes32(address),
            destinationCaller: addressToBytes32(address),
            value: usdcAmount,
            salt: getRandomSalt(),
            hookData: "0x",
          },
        };

        const signature = await walletClient.signTypedData({
          account: address,
          domain: { name: "GatewayWallet", version: "1" },
          primaryType: "BurnIntent",
          types: {
            TransferSpec: [
              { name: "version", type: "uint256" },
              { name: "sourceDomain", type: "uint32" },
              { name: "destinationDomain", type: "uint32" },
              { name: "sourceContract", type: "bytes32" },
              { name: "destinationContract", type: "bytes32" },
              { name: "sourceToken", type: "bytes32" },
              { name: "destinationToken", type: "bytes32" },
              { name: "sourceDepositor", type: "bytes32" },
              { name: "destinationRecipient", type: "bytes32" },
              { name: "sourceSigner", type: "bytes32" },
              { name: "destinationCaller", type: "bytes32" },
              { name: "value", type: "uint256" },
              { name: "salt", type: "bytes32" },
              { name: "hookData", type: "bytes" },
            ],
            BurnIntent: [
              { name: "maxBlockHeight", type: "uint256" },
              { name: "maxFee", type: "uint256" },
              { name: "feeToken", type: "bytes32" },
              { name: "sourceDomain", type: "uint32" },
              { name: "destinationDomain", type: "uint32" },
              { name: "spec", type: "TransferSpec" },
            ],
          },
          message: burnIntent,
        });

        // Step 6: Submit transfer to Gateway API
        setState(prev => ({
          ...prev,
          status: "transferring_gateway",
          progress: 82,
          currentStep: "Submitting transfer to Gateway...",
        }));

        const transferPayload: TransferIntent = {
          burnIntent: {
            maxBlockHeight: burnIntent.maxBlockHeight.toString(),
            maxFee: burnIntent.maxFee.toString(),
            feeToken: burnIntent.feeToken,
            sourceDomain: burnIntent.sourceDomain,
            destinationDomain: burnIntent.destinationDomain,
            spec: {
              version: burnIntent.spec.version.toString(),
              sourceDomain: burnIntent.spec.sourceDomain,
              destinationDomain: burnIntent.spec.destinationDomain,
              sourceContract: burnIntent.spec.sourceContract,
              destinationContract: burnIntent.spec.destinationContract,
              sourceToken: burnIntent.spec.sourceToken,
              destinationToken: burnIntent.spec.destinationToken,
              sourceDepositor: burnIntent.spec.sourceDepositor,
              destinationRecipient: burnIntent.spec.destinationRecipient,
              sourceSigner: burnIntent.spec.sourceSigner,
              destinationCaller: burnIntent.spec.destinationCaller,
              value: burnIntent.spec.value.toString(),
              salt: burnIntent.spec.salt,
              hookData: burnIntent.spec.hookData,
            },
          },
          signature,
        };

        const transferResponse = await submitTransfer([transferPayload]);

        // Validate Gateway API response
        if (!transferResponse?.attestation || !transferResponse?.signature) {
          throw new Error("Invalid Gateway API response: missing attestation or signature");
        }
        if (!transferResponse.transferId) {
          throw new Error("Invalid Gateway API response: missing transferId");
        }
        if ((transferResponse as any).error) {
          throw new Error(`Gateway API error: ${(transferResponse as any).error}`);
        }

        // Step 7: Switch to Arc and mint via GatewayMinter
        setState(prev => ({
          ...prev,
          status: "minting_gateway",
          progress: 90,
          currentStep: "Minting USDC on Arc...",
        }));

        await switchChainAsync({ chainId: GATEWAY_CONFIG.destinationChainId });

        // Validate we're on Arc before minting
        await ensureCorrectChain(walletClient, GATEWAY_CONFIG.destinationChainId, "Arc Testnet");

        const arcClient = getPublicClient("arcTestnet");
        const balanceBefore = (await arcClient.readContract({
          address: GATEWAY_CONFIG.destinationUsdc as Address,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [GATEWAY_CONFIG.zapReceiverAddress as Address],
        })) as bigint;

        notification.info("Minting USDC on Arc via Gateway...");
        const mintHash = await retryTransaction(
          async () =>
            await walletClient.writeContract({
              address: GATEWAY_CONFIG.gatewayMinter as Address,
              abi: gatewayMinterAbi,
              functionName: "gatewayMint",
              args: [transferResponse.attestation as Hex, transferResponse.signature as Hex],
              account: address,
              chain: chains.arcTestnet,
              gas: 600000n,
            }),
        );

        setState(prev => ({
          ...prev,
          txHash: mintHash,
          txChainId: chains.arcTestnet.id,
          transactions: [
            ...prev.transactions,
            {
              hash: mintHash,
              chainId: chains.arcTestnet.id,
              step: "Gateway Mint",
              timestamp: Date.now(),
            },
          ],
        }));

        // Wait for receipt AND verify status
        const mintReceipt = await arcClient.waitForTransactionReceipt({
          hash: mintHash,
          timeout: 60_000,
        });

        if (mintReceipt.status === "reverted") {
          throw new Error("Gateway mint transaction reverted. Check attestation validity.");
        }

        const balanceAfter = (await arcClient.readContract({
          address: GATEWAY_CONFIG.destinationUsdc as Address,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [GATEWAY_CONFIG.zapReceiverAddress as Address],
        })) as bigint;

        const mintedAmount = balanceAfter - balanceBefore;

        // Validate minted amount matches expectations (with small tolerance for fees)
        const expectedAmount = quote.estimatedUSDC;
        const tolerance = parseUnits("0.01", 6); // 1 cent tolerance

        if (mintedAmount < expectedAmount - tolerance) {
          throw new Error(
            `Minted amount (${(Number(mintedAmount) / 1e6).toFixed(2)} USDC) is less than expected (${(Number(expectedAmount) / 1e6).toFixed(2)} USDC)`,
          );
        }

        if (mintedAmount <= 0n) {
          throw new Error("Gateway mint succeeded but no USDC was credited to ZapReceiver.");
        }

        // Step 8: Deposit to vault via ZapReceiver
        setState(prev => ({
          ...prev,
          status: "depositing_vault",
          progress: 96,
          currentStep: "Depositing to vault...",
        }));

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

        // Validate we're still on Arc before vault deposit
        await ensureCorrectChain(walletClient, GATEWAY_CONFIG.destinationChainId, "Arc Testnet");

        notification.info("Depositing to vault via ZapReceiver...");
        const vaultHash = await retryTransaction(
          async () =>
            await walletClient.writeContract({
              address: GATEWAY_CONFIG.zapReceiverAddress as Address,
              abi: zapReceiverAbi,
              functionName: "processBridgedDeposit",
              args: [address, mintedAmount],
              account: address,
              chain: chains.arcTestnet,
              gas: 600000n,
            }),
        );

        setState(prev => ({
          ...prev,
          txHash: vaultHash,
          txChainId: chains.arcTestnet.id,
          transactions: [
            ...prev.transactions,
            {
              hash: vaultHash,
              chainId: chains.arcTestnet.id,
              step: "Vault Deposit",
              timestamp: Date.now(),
            },
          ],
        }));

        // Wait for receipt AND verify status
        const vaultReceipt = await arcClient.waitForTransactionReceipt({
          hash: vaultHash,
          timeout: 60_000,
        });

        if (vaultReceipt.status === "reverted") {
          throw new Error(
            "Vault deposit via ZapReceiver reverted. Funds are in pendingDeposits - use claimAndDeposit().",
          );
        }

        setState(prev => ({
          ...prev,
          status: "completed",
          progress: 100,
          currentStep: "Zap completed! yRWA tokens received.",
        }));

        notification.success("Zap completed! Check your yRWA balance.");
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
    reset,
  };
};
