"use client";

import { useMemo, useState } from "react";
import { formatUnits, parseUnits } from "viem";
import { useAccount, useReadContract } from "wagmi";
import { useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";

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

  const formattedSharePrice = useMemo(() => {
    if (!sharePrice) return "0.00";
    return Number(formatUnits(sharePrice, 18)).toFixed(6);
  }, [sharePrice]);

  const formattedBalance = useMemo(() => {
    if (!yRwaBalance) return "0.00";
    return Number(formatUnits(yRwaBalance, 6)).toFixed(6);
  }, [yRwaBalance]);

  const formattedTotalAssets = useMemo(() => {
    if (!totalAssets) return "0.00";
    return Number(formatUnits(totalAssets, 6)).toFixed(2);
  }, [totalAssets]);

  const formattedValue = useMemo(() => {
    if (!yRwaBalance || !sharePrice) return "0.00";
    const value = (yRwaBalance * sharePrice) / 1_000_000_000_000_000_000n;
    return Number(formatUnits(value, 6)).toFixed(2);
  }, [yRwaBalance, sharePrice]);

  const onWithdraw = async () => {
    const shares = parseUnits(withdrawAmount || "0", 6);
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
          <div className="flex flex-col gap-4 md:flex-row md:items-end">
            <div className="form-control w-full">
              <label className="label">
                <span className="label-text">yRWA Amount</span>
              </label>
              <input
                className="input input-bordered w-full"
                value={withdrawAmount}
                onChange={e => setWithdrawAmount(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <button className="btn btn-primary" onClick={onWithdraw} disabled={isPending}>
              {isPending ? "Withdrawing..." : "Withdraw"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
