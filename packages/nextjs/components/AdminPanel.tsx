"use client";

import { useMemo, useState } from "react";
import { formatUnits, parseUnits } from "viem";
import { useAccount, useWriteContract } from "wagmi";
import { useDeployedContractInfo, useScaffoldReadContract } from "~~/hooks/scaffold-eth";
import { GATEWAY_CONFIG } from "~~/lib/gateway-config";

const erc20ApproveAbi = [
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

export const AdminPanel = () => {
  const { address } = useAccount();
  const [investAmount, setInvestAmount] = useState("");
  const [yieldAmount, setYieldAmount] = useState("");
  const [rwaValue, setRwaValue] = useState("");

  const { data: owner } = useScaffoldReadContract({
    contractName: "RWAVault",
    functionName: "owner",
  });
  const { data: totalUSDC } = useScaffoldReadContract({
    contractName: "RWAVault",
    functionName: "totalUSDC",
  });
  const { data: totalRWAValue } = useScaffoldReadContract({
    contractName: "RWAVault",
    functionName: "totalRWAValue",
  });
  const { data: vaultInfo } = useDeployedContractInfo({ contractName: "RWAVault" });

  const isOwner = owner && address && owner.toLowerCase() === address.toLowerCase();

  const { writeContractAsync: writeVaultAsync, isPending } = useWriteContract();
  const { writeContractAsync: approveAsync } = useWriteContract();

  const vaultWriteAbi = [
    {
      type: "function",
      name: "withdrawForInvestment",
      inputs: [{ name: "amount", type: "uint256" }],
      outputs: [],
      stateMutability: "nonpayable",
    },
    {
      type: "function",
      name: "depositYield",
      inputs: [{ name: "amount", type: "uint256" }],
      outputs: [],
      stateMutability: "nonpayable",
    },
    {
      type: "function",
      name: "updateRWAValue",
      inputs: [{ name: "newValue", type: "uint256" }],
      outputs: [],
      stateMutability: "nonpayable",
    },
  ] as const;

  const onWithdrawForInvestment = async () => {
    if (!vaultInfo?.address || !investAmount) return;
    const amount = parseUnits(investAmount, 6);
    if (amount > (totalUSDC || 0n)) {
      alert(`Insufficient USDC in vault. Available: ${formattedUSDC}`);
      return;
    }
    await writeVaultAsync({
      address: vaultInfo.address,
      abi: vaultWriteAbi,
      functionName: "withdrawForInvestment",
      args: [amount],
    });
    setInvestAmount("");
  };

  const onApproveAndDepositYield = async () => {
    if (!vaultInfo?.address || !yieldAmount) return;
    const amount = parseUnits(yieldAmount, 6);

    try {
      await approveAsync({
        address: GATEWAY_CONFIG.destinationUsdc as `0x${string}`,
        abi: erc20ApproveAbi,
        functionName: "approve",
        args: [vaultInfo.address, amount],
      });

      await writeVaultAsync({
        address: vaultInfo.address,
        abi: vaultWriteAbi,
        functionName: "depositYield",
        args: [amount],
      });

      setYieldAmount("");
    } catch (error) {
      console.error("Deposit yield error:", error);
    }
  };

  const onUpdateRWAValue = async () => {
    if (!vaultInfo?.address) return;
    const amount = parseUnits(rwaValue || "0", 6);
    await writeVaultAsync({
      address: vaultInfo.address,
      abi: vaultWriteAbi,
      functionName: "updateRWAValue",
      args: [amount],
    });
    setRwaValue("");
  };

  const formattedUSDC = useMemo(() => (totalUSDC ? Number(formatUnits(totalUSDC, 6)).toFixed(2) : "0.00"), [totalUSDC]);
  const formattedRWA = useMemo(
    () => (totalRWAValue ? Number(formatUnits(totalRWAValue, 6)).toFixed(2) : "0.00"),
    [totalRWAValue],
  );

  if (!isOwner) {
    return (
      <div className="card bg-base-100 shadow-xl">
        <div className="card-body">
          <h2 className="card-title">Admin Panel</h2>
          <p className="opacity-70">Connect the owner wallet to access admin controls.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="card bg-base-100 shadow-xl">
        <div className="card-body">
          <h2 className="card-title">Vault Stats</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl bg-base-200 p-4">
              <div className="text-sm opacity-70">Liquid USDC</div>
              <div className="text-xl font-semibold">{formattedUSDC}</div>
            </div>
            <div className="rounded-xl bg-base-200 p-4">
              <div className="text-sm opacity-70">RWA Value</div>
              <div className="text-xl font-semibold">{formattedRWA}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="card bg-base-100 shadow-xl">
        <div className="card-body">
          <h2 className="card-title">Withdraw for Investment</h2>
          <p className="text-sm opacity-70 mb-4">
            Withdraw USDC from vault to treasury for RWA investments. This reduces liquid USDC available for user
            withdrawals.
          </p>
          <div className="form-control">
            <label className="label">
              <span className="label-text">USDC Amount</span>
              <span className="label-text-alt">Available: {formattedUSDC} USDC</span>
            </label>
            <input
              type="number"
              className="input input-bordered"
              value={investAmount}
              onChange={e => setInvestAmount(e.target.value)}
              placeholder="Enter amount"
              step="0.01"
              min="0"
              max={formattedUSDC}
            />
          </div>
          <button
            className="btn btn-primary mt-2"
            onClick={onWithdrawForInvestment}
            disabled={isPending || !investAmount || Number(investAmount) <= 0}
          >
            {isPending ? "Withdrawing..." : "Withdraw for Investment"}
          </button>
        </div>
      </div>

      <div className="card bg-base-100 shadow-xl">
        <div className="card-body">
          <h2 className="card-title">Deposit Yield</h2>
          <p className="text-sm opacity-70 mb-4">
            Deposit yield earnings back to vault. 20% fee goes to treasury, 80% increases share price for all holders.
          </p>
          <div className="form-control">
            <label className="label">
              <span className="label-text">Yield Amount (USDC)</span>
            </label>
            <input
              type="number"
              className="input input-bordered"
              value={yieldAmount}
              onChange={e => setYieldAmount(e.target.value)}
              placeholder="Enter yield amount"
              step="0.01"
              min="0"
            />
          </div>
          {yieldAmount && Number(yieldAmount) > 0 && (
            <div className="alert alert-info mt-2">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                className="h-6 w-6 shrink-0 stroke-current"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                ></path>
              </svg>
              <div className="text-sm">
                <div>Treasury fee (20%): {(Number(yieldAmount) * 0.2).toFixed(2)} USDC</div>
                <div>To vault (80%): {(Number(yieldAmount) * 0.8).toFixed(2)} USDC</div>
              </div>
            </div>
          )}
          <button
            className="btn btn-primary mt-2"
            onClick={onApproveAndDepositYield}
            disabled={isPending || !yieldAmount || Number(yieldAmount) <= 0}
          >
            {isPending ? "Processing..." : "Approve & Deposit Yield"}
          </button>
        </div>
      </div>

      <div className="card bg-base-100 shadow-xl">
        <div className="card-body">
          <h2 className="card-title">Update RWA Valuation</h2>
          <p className="text-sm opacity-70 mb-4">
            Update the total value of Real World Assets held by the protocol. This affects the share price calculation.
          </p>
          <div className="form-control">
            <label className="label">
              <span className="label-text">New RWA Value (USDC)</span>
              <span className="label-text-alt">Current: {formattedRWA} USDC</span>
            </label>
            <input
              type="number"
              className="input input-bordered"
              value={rwaValue}
              onChange={e => setRwaValue(e.target.value)}
              placeholder="Enter new RWA value"
              step="0.01"
              min="0"
            />
          </div>
          <button
            className="btn btn-primary mt-2"
            onClick={onUpdateRWAValue}
            disabled={isPending || !rwaValue || Number(rwaValue) < 0}
          >
            {isPending ? "Updating..." : "Update RWA Value"}
          </button>
        </div>
      </div>
    </div>
  );
};
