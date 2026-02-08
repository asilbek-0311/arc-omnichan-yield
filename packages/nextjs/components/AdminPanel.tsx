"use client";

import { useMemo, useState } from "react";
import { Address } from "@scaffold-ui/components";
import { formatUnits, parseUnits } from "viem";
import { useAccount, useWriteContract } from "wagmi";
import { useDeployedContractInfo, useScaffoldEventHistory, useScaffoldReadContract } from "~~/hooks/scaffold-eth";
import { useUscyTreasury } from "~~/hooks/useUscyTreasury";
import { GATEWAY_CONFIG } from "~~/lib/gateway-config";
import { USYC_CONFIG } from "~~/lib/usyc-config";

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
  const [usycDepositAmount, setUscyDepositAmount] = useState("");
  const [usycRedeemAmount, setUscyRedeemAmount] = useState("");

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
  const { data: zapInfo } = useDeployedContractInfo({ contractName: "ZapReceiver" });

  const allowlist = useMemo(
    () =>
      (process.env.NEXT_PUBLIC_ADMIN_ALLOWLIST || "")
        .split(",")
        .map(item => item.trim().toLowerCase())
        .filter(Boolean),
    [],
  );
  const isOwner = owner && address && owner.toLowerCase() === address.toLowerCase();
  const isAllowlisted = address ? allowlist.includes(address.toLowerCase()) : false;
  const canViewAdmin = Boolean(isOwner || isAllowlisted);

  const { data: vaultDepositEvents, isLoading: isLoadingVaultDeposits } = useScaffoldEventHistory({
    contractName: "RWAVault",
    eventName: "Deposited",
    watch: true,
    enabled: canViewAdmin,
  });
  const { data: zapCompletedEvents, isLoading: isLoadingZapCompleted } = useScaffoldEventHistory({
    contractName: "ZapReceiver",
    eventName: "ZapCompleted",
    watch: true,
    enabled: canViewAdmin,
  });
  const { data: zapClaimedEvents, isLoading: isLoadingZapClaimed } = useScaffoldEventHistory({
    contractName: "ZapReceiver",
    eventName: "PendingDepositClaimed",
    watch: true,
    enabled: canViewAdmin,
  });
  const isLoadingDepositors = isLoadingVaultDeposits || isLoadingZapCompleted || isLoadingZapClaimed;

  const { writeContractAsync: writeVaultAsync, isPending } = useWriteContract();
  const { writeContractAsync: approveAsync } = useWriteContract();
  const usycTreasury = useUscyTreasury();

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
  const depositors = useMemo(() => {
    const depositorMap = new Map<string, { address: `0x${string}`; totalDeposited: bigint; depositCount: number }>();

    const addDepositor = (user: `0x${string}`, amount: bigint) => {
      const key = user.toLowerCase();
      const existing = depositorMap.get(key) ?? { address: user, totalDeposited: 0n, depositCount: 0 };
      existing.totalDeposited += amount;
      existing.depositCount += 1;
      depositorMap.set(key, existing);
    };

    const zapReceiverAddress = zapInfo?.address?.toLowerCase();

    for (const event of vaultDepositEvents ?? []) {
      const user = event?.args?.user as `0x${string}` | undefined;
      if (!user) continue;
      if (zapReceiverAddress && user.toLowerCase() === zapReceiverAddress) continue;
      const amount = (event?.args as { usdcIn?: bigint })?.usdcIn ?? 0n;
      addDepositor(user, amount);
    }

    for (const event of zapCompletedEvents ?? []) {
      const recipient = (event?.args as { recipient?: `0x${string}` })?.recipient;
      if (!recipient) continue;
      const amount = (event?.args as { usdcAmount?: bigint })?.usdcAmount ?? 0n;
      addDepositor(recipient, amount);
    }

    for (const event of zapClaimedEvents ?? []) {
      const user = (event?.args as { user?: `0x${string}` })?.user;
      if (!user) continue;
      const amount = (event?.args as { amount?: bigint })?.amount ?? 0n;
      addDepositor(user, amount);
    }

    return Array.from(depositorMap.values()).sort((a, b) => {
      if (a.totalDeposited === b.totalDeposited) return 0;
      return a.totalDeposited > b.totalDeposited ? -1 : 1;
    });
  }, [vaultDepositEvents, zapCompletedEvents, zapClaimedEvents, zapInfo?.address]);

  if (!canViewAdmin) {
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
      {!isOwner && (
        <div className="alert alert-warning">
          <div>
            <div className="font-semibold">View-only access</div>
            <div className="text-sm">Owner wallet required to run admin transactions.</div>
          </div>
        </div>
      )}

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
          <div className="flex items-center justify-between">
            <h2 className="card-title">Depositors</h2>
            <span className="badge badge-outline">{depositors.length}</span>
          </div>
          <p className="text-sm opacity-70">Unique wallets that have deposited into the vault.</p>
          {isLoadingDepositors && <p className="text-sm opacity-70">Loading depositors...</p>}
          {!isLoadingDepositors && depositors.length === 0 && <p className="text-sm opacity-70">No deposits yet.</p>}
          {depositors.length > 0 && (
            <div className="mt-4 space-y-3 max-h-72 overflow-y-auto">
              {depositors.map(depositor => (
                <div key={depositor.address} className="flex items-center justify-between rounded-lg bg-base-200 p-3">
                  <Address address={depositor.address} onlyEnsOrAddress />
                  <div className="text-right text-sm">
                    <div className="font-semibold">{formatUnits(depositor.totalDeposited, 6)} USDC</div>
                    <div className="text-xs opacity-60">{depositor.depositCount} deposits</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card bg-base-100 shadow-xl">
        <div className="card-body">
          <h2 className="card-title">USYC Treasury</h2>
          <p className="text-sm opacity-70 mb-4">
            Manage USYC subscriptions and redemptions on Arc testnet. Wallet must be allowlisted.
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl bg-base-200 p-4">
              <div className="text-sm opacity-70">Arc USDC Balance</div>
              <div className="text-xl font-semibold">{usycTreasury.formattedUsdc}</div>
            </div>
            <div className="rounded-xl bg-base-200 p-4">
              <div className="text-sm opacity-70">USYC Balance</div>
              <div className="text-xl font-semibold">{usycTreasury.formattedUscy}</div>
            </div>
          </div>

          <div className="grid gap-6 mt-6 md:grid-cols-2">
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Subscribe (USDC → USYC)</h3>
              <div className="form-control">
                <label className="label">
                  <span className="label-text">USDC Amount</span>
                  <span className="label-text-alt">Available: {usycTreasury.formattedUsdc}</span>
                </label>
                <input
                  type="number"
                  className="input input-bordered"
                  value={usycDepositAmount}
                  onChange={e => setUscyDepositAmount(e.target.value)}
                  placeholder="Enter amount"
                  step="0.01"
                  min="0"
                />
              </div>
              <button
                className="btn btn-primary w-full"
                onClick={() => usycTreasury.deposit(usycDepositAmount)}
                disabled={
                  !usycDepositAmount ||
                  Number(usycDepositAmount) <= 0 ||
                  ["approving", "depositing", "redeeming", "switching"].includes(usycTreasury.status) ||
                  !isOwner
                }
              >
                {usycTreasury.status === "approving" && "Approving..."}
                {usycTreasury.status === "depositing" && "Depositing..."}
                {usycTreasury.status === "switching" && "Switching Network..."}
                {usycTreasury.status === "idle" && "Approve & Deposit"}
                {usycTreasury.status === "completed" && "Deposit Complete"}
                {usycTreasury.status === "error" && "Try Again"}
              </button>
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Redeem (USYC → USDC)</h3>
              <div className="form-control">
                <label className="label">
                  <span className="label-text">USYC Amount</span>
                  <span className="label-text-alt">Available: {usycTreasury.formattedUscy}</span>
                </label>
                <input
                  type="number"
                  className="input input-bordered"
                  value={usycRedeemAmount}
                  onChange={e => setUscyRedeemAmount(e.target.value)}
                  placeholder="Enter amount"
                  step="0.01"
                  min="0"
                />
              </div>
              <button
                className="btn btn-outline w-full"
                onClick={() => usycTreasury.redeem(usycRedeemAmount)}
                disabled={
                  !usycRedeemAmount ||
                  Number(usycRedeemAmount) <= 0 ||
                  ["approving", "depositing", "redeeming", "switching"].includes(usycTreasury.status) ||
                  !isOwner
                }
              >
                {usycTreasury.status === "approving" && "Approving..."}
                {usycTreasury.status === "redeeming" && "Redeeming..."}
                {usycTreasury.status === "switching" && "Switching Network..."}
                {usycTreasury.status === "idle" && "Approve & Redeem"}
                {usycTreasury.status === "completed" && "Redemption Complete"}
                {usycTreasury.status === "error" && "Try Again"}
              </button>
            </div>
          </div>

          <div className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span>Status:</span>
              <span className="badge badge-primary">{usycTreasury.status}</span>
            </div>
            {usycTreasury.txHash && (
              <div className="flex justify-between">
                <span>Transaction:</span>
                <a
                  href={`https://testnet.arcscan.app/tx/${usycTreasury.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="link link-primary"
                >
                  View on Arcscan
                </a>
              </div>
            )}
            {usycTreasury.error && (
              <div className="alert alert-error">
                <span className="text-sm">{usycTreasury.error}</span>
              </div>
            )}
          </div>

          <div className="divider">Recent USYC Activity</div>
          {usycTreasury.history.length === 0 && <p className="text-sm opacity-70">No USYC activity yet.</p>}
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {usycTreasury.history.map(entry => (
              <div key={entry.timestamp} className="rounded-lg bg-base-200 p-3 text-sm">
                <div className="flex justify-between items-center">
                  <span className="opacity-70">{new Date(entry.timestamp).toLocaleString()}</span>
                  <span className="badge badge-sm badge-primary">{entry.status}</span>
                </div>
                <div className="mt-1 flex justify-between">
                  <span className="font-medium">{entry.type === "deposit" ? "Subscribe" : "Redeem"}</span>
                  <span>{entry.amount}</span>
                </div>
                {entry.txHash && (
                  <div className="mt-1">
                    <a
                      href={`https://testnet.arcscan.app/tx/${entry.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="link link-primary text-xs"
                    >
                      View Tx →
                    </a>
                  </div>
                )}
                {entry.error && (
                  <div className="alert alert-error text-xs p-2 mt-2">
                    <span>{entry.error}</span>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="divider">Future Upgrade</div>
          <div className="alert alert-info">
            <div>
              <div className="font-semibold">Oracle-based RWA sync (coming soon)</div>
              <div className="text-sm">
                Once an on-chain oracle is available, you will be able to sync total RWA value automatically from USYC.
                Current flow remains manual until then.
              </div>
            </div>
          </div>
          <div className="mt-3 text-xs opacity-60">Entitlements: {USYC_CONFIG.entitlements}</div>
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
            disabled={isPending || !investAmount || Number(investAmount) <= 0 || !isOwner}
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
            disabled={isPending || !yieldAmount || Number(yieldAmount) <= 0 || !isOwner}
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
            disabled={isPending || !rwaValue || Number(rwaValue) < 0 || !isOwner}
          >
            {isPending ? "Updating..." : "Update RWA Value"}
          </button>
        </div>
      </div>
    </div>
  );
};
