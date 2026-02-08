import { useCallback, useState } from "react";
import { useDeployedContractInfo } from "./scaffold-eth";
import { createPublicClient, formatUnits, http } from "viem";
import { arcTestnet } from "viem/chains";
import { useAccount, useSwitchChain, useWalletClient } from "wagmi";
import { GATEWAY_CONFIG } from "~~/lib/gateway-config";
import { notification } from "~~/utils/scaffold-eth";

type VaultDepositStatus = "idle" | "switching" | "approving" | "depositing" | "completed" | "error";

type VaultDepositState = {
  status: VaultDepositStatus;
  txHash?: string;
  error?: string;
  amount?: bigint;
};

const erc20Abi = [
  {
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    name: "allowance",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

// MAX uint256 for infinite approval
const MAX_UINT256 = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");

// Helper function to retry transactions with exponential backoff
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

export const useVaultDeposit = () => {
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();
  const { data: vaultInfo } = useDeployedContractInfo("RWAVault");

  const [state, setState] = useState<VaultDepositState>({
    status: "idle",
  });

  const depositToVault = useCallback(
    async (amount: bigint) => {
      if (!address || !walletClient || !vaultInfo) {
        notification.error("Wallet not connected or vault not found");
        return;
      }

      try {
        setState({ status: "switching", amount });

        // Step 1: Switch to Arc Testnet if not already there
        let currentChainId = await walletClient.getChainId();
        if (currentChainId !== GATEWAY_CONFIG.destinationChainId) {
          notification.info("Switching to Arc Testnet...");
          await switchChainAsync({ chainId: GATEWAY_CONFIG.destinationChainId });

          // Wait and verify wallet actually switched
          let attempts = 0;
          const maxAttempts = 10;
          while (attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 500));
            currentChainId = await walletClient.getChainId();
            if (currentChainId === GATEWAY_CONFIG.destinationChainId) {
              notification.success("Switched to Arc Testnet");
              break;
            }
            attempts++;
          }

          // Final verification
          if (currentChainId !== GATEWAY_CONFIG.destinationChainId) {
            throw new Error(
              `Failed to switch to Arc Testnet. Please manually switch your wallet to Arc Testnet and try again.`,
            );
          }
        }

        // Create Arc-specific public client (not affected by wagmi chain state)
        const arcPublicClient = createPublicClient({
          chain: arcTestnet,
          transport: http(
            GATEWAY_CONFIG.destinationChainId === 5042002
              ? "https://rpc.quicknode.testnet.arc.network"
              : arcTestnet.rpcUrls.default.http[0],
          ),
        });

        // Step 2: Check USDC balance on Arc
        const usdcBalance = (await arcPublicClient.readContract({
          address: GATEWAY_CONFIG.destinationUsdc as `0x${string}`,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address],
        })) as bigint;

        if (usdcBalance < amount) {
          throw new Error(
            `Insufficient USDC balance. Have: ${formatUnits(usdcBalance, 6)}, Need: ${formatUnits(amount, 6)}`,
          );
        }

        setState({ status: "approving", amount });

        // Step 3: Check current allowance
        const currentAllowance = (await arcPublicClient.readContract({
          address: GATEWAY_CONFIG.destinationUsdc as `0x${string}`,
          abi: erc20Abi,
          functionName: "allowance",
          args: [address, vaultInfo.address],
        })) as bigint;

        // Step 4: Approve USDC to vault if needed
        if (currentAllowance < amount) {
          notification.info("Approving unlimited USDC to vault...");
          const approveHash = await retryTransaction(
            async () =>
              await walletClient.writeContract({
                address: GATEWAY_CONFIG.destinationUsdc as `0x${string}`,
                abi: erc20Abi,
                functionName: "approve",
                args: [vaultInfo.address, MAX_UINT256], // ← Approve unlimited
                chain: arcTestnet,
                account: address,
              }),
          );

          notification.info("Waiting for approval confirmation...");
          await arcPublicClient.waitForTransactionReceipt({
            hash: approveHash,
            timeout: 60_000, // 1 min timeout
          });
          notification.success("USDC approved!");
        } else {
          notification.info("USDC already approved");
        }

        setState({ status: "depositing", amount });

        // Step 5: Deposit to vault
        notification.info("Depositing to vault...");
        const depositHash = await retryTransaction(
          async () =>
            await walletClient.writeContract({
              address: vaultInfo.address,
              abi: [
                {
                  inputs: [{ name: "amount", type: "uint256" }],
                  name: "deposit",
                  outputs: [],
                  stateMutability: "nonpayable",
                  type: "function",
                },
              ],
              functionName: "deposit",
              args: [amount],
              chain: arcTestnet,
              account: address,
            }),
        );

        setState({ status: "depositing", amount, txHash: depositHash });
        notification.info("Waiting for deposit confirmation...");

        await arcPublicClient.waitForTransactionReceipt({
          hash: depositHash,
          timeout: 60_000, // 1 min timeout
        });

        setState({ status: "completed", amount, txHash: depositHash });
        notification.success(`Successfully deposited ${formatUnits(amount, 6)} USDC to vault!`);
      } catch (error: any) {
        console.error("Vault deposit error:", error);
        setState({
          status: "error",
          amount,
          error: error.message || "Unknown error occurred",
        });
        notification.error(`Deposit failed: ${error.message || "Unknown error"}`);
      }
    },
    [address, walletClient, switchChainAsync, vaultInfo],
  );

  const reset = useCallback(() => {
    setState({ status: "idle" });
  }, []);

  return {
    depositToVault,
    reset,
    ...state,
  };
};
