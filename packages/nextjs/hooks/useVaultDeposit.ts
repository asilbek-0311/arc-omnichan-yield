import { useCallback, useState } from "react";
import { useDeployedContractInfo } from "./scaffold-eth";
import { formatUnits } from "viem";
import { useAccount, usePublicClient, useSwitchChain, useWalletClient } from "wagmi";
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

export const useVaultDeposit = () => {
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const { switchChainAsync } = useSwitchChain();
  const { data: vaultInfo } = useDeployedContractInfo("RWAVault");

  const [state, setState] = useState<VaultDepositState>({
    status: "idle",
  });

  const depositToVault = useCallback(
    async (amount: bigint) => {
      if (!address || !walletClient || !publicClient || !vaultInfo) {
        notification.error("Wallet not connected or vault not found");
        return;
      }

      try {
        setState({ status: "switching", amount });

        // Step 1: Switch to Arc Testnet if not already there
        const currentChainId = await walletClient.getChainId();
        if (currentChainId !== GATEWAY_CONFIG.destinationChainId) {
          notification.info("Switching to Arc Testnet...");
          await switchChainAsync({ chainId: GATEWAY_CONFIG.destinationChainId });
        }

        // Step 2: Check USDC balance on Arc
        const usdcBalance = (await publicClient.readContract({
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
        const currentAllowance = (await publicClient.readContract({
          address: GATEWAY_CONFIG.destinationUsdc as `0x${string}`,
          abi: erc20Abi,
          functionName: "allowance",
          args: [address, vaultInfo.address],
        })) as bigint;

        // Step 4: Approve USDC to vault if needed
        if (currentAllowance < amount) {
          notification.info("Approving USDC to vault...");
          const approveHash = await walletClient.writeContract({
            address: GATEWAY_CONFIG.destinationUsdc as `0x${string}`,
            abi: erc20Abi,
            functionName: "approve",
            args: [vaultInfo.address, amount],
            chain: walletClient.chain,
            account: address,
          });

          notification.info("Waiting for approval confirmation...");
          await publicClient.waitForTransactionReceipt({ hash: approveHash });
          notification.success("USDC approved!");
        } else {
          notification.info("USDC already approved");
        }

        setState({ status: "depositing", amount });

        // Step 5: Deposit to vault
        notification.info("Depositing to vault...");
        const depositHash = await walletClient.writeContract({
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
          chain: walletClient.chain,
          account: address,
        });

        setState({ status: "depositing", amount, txHash: depositHash });
        notification.info("Waiting for deposit confirmation...");

        await publicClient.waitForTransactionReceipt({ hash: depositHash });

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
    [address, walletClient, publicClient, switchChainAsync, vaultInfo],
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
