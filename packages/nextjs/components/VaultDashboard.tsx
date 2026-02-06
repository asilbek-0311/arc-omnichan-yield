"use client";

import { useMemo, useState } from "react";
import { formatUnits, parseUnits } from "viem";
import { useAccount, useReadContract } from "wagmi";
import { useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import {
  calculateMaxWithdrawable,
  calculateUSDCValue,
  formatSharePrice,
  formatUSDCValue,
  formatYRWABalance,
} from "~~/utils/vault-helpers";

const erc20BalanceAbi = [
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

export const VaultDashboard = () => {
  const { address } = useAccount();
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const { data: sharePrice } = useScaffoldReadContract({
    contractName: "RWAVault",
    functionName: "sharePrice",
  });
  const { data: totalAssets } = useScaffoldReadContract({
    contractName: "RWAVault",
    functionName: "totalAssets",
  });
  const { data: totalUSDC } = useScaffoldReadContract({
    contractName: "RWAVault",
    functionName: "totalUSDC",
  });
  const { data: yieldTokenAddress } = useScaffoldReadContract({
    contractName: "RWAVault",
    functionName: "yieldToken",
  });

  const { data: yRwaBalance } = useReadContract({
    address: yieldTokenAddress,
    abi: erc20BalanceAbi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address && yieldTokenAddress) },
  });

  const { writeContractAsync, isPending } = useScaffoldWriteContract({
    contractName: "RWAVault",
  });

  const formattedSharePrice = useMemo(() => formatSharePrice(sharePrice), [sharePrice]);

  const formattedBalance = useMemo(() => formatYRWABalance(yRwaBalance), [yRwaBalance]);

  const formattedTotalAssets = useMemo(() => formatUSDCValue(totalAssets), [totalAssets]);

  const formattedValue = useMemo(() => {
    if (!yRwaBalance || !sharePrice) return "0.00";
    const value = calculateUSDCValue(yRwaBalance, sharePrice);
    return formatUSDCValue(value);
  }, [yRwaBalance, sharePrice]);

  const maxWithdrawable = useMemo(() => {
    if (!totalUSDC || !sharePrice || sharePrice === 0n) return 0n;
    return calculateMaxWithdrawable(totalUSDC, sharePrice);
  }, [totalUSDC, sharePrice]);

  const formattedMaxWithdrawable = useMemo(() => formatYRWABalance(maxWithdrawable), [maxWithdrawable]);

  const withdrawalValue = useMemo(() => {
    if (!withdrawAmount || !sharePrice) return "0.00";
    try {
      const shares = parseUnits(withdrawAmount, 6);
      const value = (shares * sharePrice) / 1_000_000_000_000_000_000n;
      return Number(formatUnits(value, 6)).toFixed(2);
    } catch {
      return "0.00";
    }
  }, [withdrawAmount, sharePrice]);

  const onWithdraw = async () => {
    const shares = parseUnits(withdrawAmount || "0", 6);
    if (shares > maxWithdrawable) {
      alert(`Insufficient USDC liquidity in vault. Max withdrawable: ${formattedMaxWithdrawable} yRWA`);
      return;
    }
    await writeContractAsync({
      functionName: "withdraw",
      args: [shares],
    });
    setWithdrawAmount("");
  };

  return (
    <div className="space-y-6">
      <div className="card bg-base-100 shadow-xl">
        <div className="card-body">
          <h2 className="card-title">Your Position</h2>
          <div className="grid gap-4 md:grid-cols-4">
            <div className="rounded-xl bg-base-200 p-4">
              <div className="text-sm opacity-70">yRWA Balance</div>
              <div className="text-xl font-semibold">{formattedBalance}</div>
            </div>
            <div className="rounded-xl bg-base-200 p-4">
              <div className="text-sm opacity-70">Current Value</div>
              <div className="text-xl font-semibold">{formattedValue} USDC</div>
            </div>
            <div className="rounded-xl bg-base-200 p-4">
              <div className="text-sm opacity-70">Share Price</div>
              <div className="text-xl font-semibold">{formattedSharePrice}</div>
            </div>
            <div className="rounded-xl bg-base-200 p-4">
              <div className="text-sm opacity-70">Total Vault Assets</div>
              <div className="text-xl font-semibold">{formattedTotalAssets} USDC</div>
            </div>
          </div>
        </div>
      </div>

      <div className="card bg-base-100 shadow-xl">
        <div className="card-body">
          <h2 className="card-title">Withdraw</h2>
          <div className="space-y-4">
            <div className="flex flex-col gap-4 md:flex-row md:items-end">
              <div className="form-control w-full">
                <label className="label">
                  <span className="label-text">yRWA Amount</span>
                  <span className="label-text-alt">
                    Max: {formattedMaxWithdrawable} (${withdrawalValue} USDC)
                  </span>
                </label>
                <input
                  type="number"
                  className="input input-bordered w-full"
                  value={withdrawAmount}
                  onChange={e => setWithdrawAmount(e.target.value)}
                  placeholder="0.00"
                  step="0.01"
                  min="0"
                  max={formattedMaxWithdrawable}
                />
              </div>
              <button
                className="btn btn-primary"
                onClick={onWithdraw}
                disabled={
                  isPending ||
                  !withdrawAmount ||
                  Number(withdrawAmount) <= 0 ||
                  parseUnits(withdrawAmount || "0", 6) > maxWithdrawable
                }
              >
                {isPending ? "Withdrawing..." : "Withdraw"}
              </button>
            </div>
            {totalUSDC !== undefined && maxWithdrawable < (yRwaBalance || 0n) && (
              <div className="alert alert-warning">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-6 w-6 shrink-0 stroke-current"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
                <span>
                  Limited USDC liquidity in vault. You can only withdraw up to {formattedMaxWithdrawable} yRWA.
                  <br />
                  Vault has {formatUnits(totalUSDC || 0n, 6)} USDC available.
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
