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
    if (!vaultInfo?.address) return;
    const amount = parseUnits(investAmount || "0", 6);
    await writeVaultAsync({
      address: vaultInfo.address,
      abi: vaultWriteAbi,
      functionName: "withdrawForInvestment",
      args: [amount],
    });
    setInvestAmount("");
  };

  const onApproveYield = async () => {
    if (!vaultInfo?.address) return;
    const amount = parseUnits(yieldAmount || "0", 6);
    await approveAsync({
      address: GATEWAY_CONFIG.destinationUsdc,
      abi: erc20ApproveAbi,
      functionName: "approve",
      args: [vaultInfo?.address as `0x${string}`, amount],
    });
  };

  const onDepositYield = async () => {
    if (!vaultInfo?.address) return;
    const amount = parseUnits(yieldAmount || "0", 6);
    await writeVaultAsync({
      address: vaultInfo.address,
      abi: vaultWriteAbi,
      functionName: "depositYield",
      args: [amount],
    });
    setYieldAmount("");
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
          <input
            className="input input-bordered"
            value={investAmount}
            onChange={e => setInvestAmount(e.target.value)}
            placeholder="USDC amount"
          />
          <button className="btn btn-primary" onClick={onWithdrawForInvestment} disabled={isPending}>
            Withdraw
          </button>
        </div>
      </div>

      <div className="card bg-base-100 shadow-xl">
        <div className="card-body">
          <h2 className="card-title">Deposit Yield</h2>
          <input
            className="input input-bordered"
            value={yieldAmount}
            onChange={e => setYieldAmount(e.target.value)}
            placeholder="USDC amount"
          />
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-outline" onClick={onApproveYield} disabled={!vaultInfo?.address}>
              Approve USDC
            </button>
            <button className="btn btn-primary" onClick={onDepositYield} disabled={isPending}>
              Deposit Yield
            </button>
          </div>
        </div>
      </div>

      <div className="card bg-base-100 shadow-xl">
        <div className="card-body">
          <h2 className="card-title">Update RWA Valuation</h2>
          <input
            className="input input-bordered"
            value={rwaValue}
            onChange={e => setRwaValue(e.target.value)}
            placeholder="USDC value"
          />
          <button className="btn btn-primary" onClick={onUpdateRWAValue} disabled={isPending}>
            Update Value
          </button>
        </div>
      </div>
    </div>
  );
};
