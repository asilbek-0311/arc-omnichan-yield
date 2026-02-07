/**
 * useZapRecovery - Handle failed vault deposits
 *
 * If Circle Gateway successfully bridges USDC to Arc but ZapReceiver fails to deposit to vault,
 * funds are stored in ZapReceiver's pendingDeposits mapping for manual recovery.
 */
import { useCallback, useEffect, useState } from "react";
import { formatUnits } from "viem";
import { useAccount } from "wagmi";
import { useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { notification } from "~~/utils/scaffold-eth/notification";

export const useZapRecovery = () => {
  const { address } = useAccount();
  const [isRecovering, setIsRecovering] = useState(false);

  // Read pending deposits for connected user
  const { data: pendingAmount, refetch: refetchPending } = useScaffoldReadContract({
    contractName: "ZapReceiver",
    functionName: "pendingDeposits",
    args: [address as `0x${string}` | undefined],
  });

  // Write contract to claim pending deposits
  const { writeContractAsync: claimAndDeposit } = useScaffoldWriteContract({
    contractName: "ZapReceiver",
  });

  // Check for pending deposits on mount and when address changes
  useEffect(() => {
    if (address) {
      refetchPending();
    }
  }, [address, refetchPending]);

  /**
   * Manually retry vault deposit for pending funds
   */
  const retryDeposit = useCallback(async () => {
    if (!address) {
      notification.error("Connect your wallet to retry deposit");
      return;
    }

    if (!pendingAmount || pendingAmount === 0n) {
      notification.error("No pending deposits to recover");
      return;
    }

    try {
      setIsRecovering(true);

      notification.info(`Retrying vault deposit for ${formatUnits(pendingAmount, 6)} USDC...`);

      await claimAndDeposit({
        functionName: "claimAndDeposit",
      });

      notification.success(`Successfully deposited ${formatUnits(pendingAmount, 6)} USDC to vault!`);

      // Refetch to update UI
      await refetchPending();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Recovery failed";
      notification.error(`Recovery failed: ${message}`);
    } finally {
      setIsRecovering(false);
    }
  }, [address, pendingAmount, claimAndDeposit, refetchPending]);

  return {
    pendingAmount: pendingAmount || 0n,
    hasPending: pendingAmount ? pendingAmount > 0n : false,
    isRecovering,
    retryDeposit,
    refetchPending,
  };
};
