"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatUnits, parseUnits } from "viem";
import { useAccount, useChainId, usePublicClient } from "wagmi";
import { useDepositHistory } from "~~/hooks/useDepositHistory";
import { useVaultDeposit } from "~~/hooks/useVaultDeposit";
import { GATEWAY_CONFIG } from "~~/lib/gateway-config";

const erc20Abi = [
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

const getExplorerUrl = (chainId: number, txHash: string) => {
  const explorers: Record<number, string> = {
    11155111: "https://sepolia.etherscan.io/tx/",
    43113: "https://testnet.snowtrace.io/tx/",
    84532: "https://sepolia.basescan.org/tx/",
    421614: "https://sepolia.arbiscan.io/tx/",
    5042002: "https://testnet.arcscan.app/tx/",
  };
  return explorers[chainId] ? `${explorers[chainId]}${txHash}` : null;
};

export const DirectArcDeposit = () => {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient({ chainId: GATEWAY_CONFIG.destinationChainId });
  const { saveDeposit, updateDeposit } = useDepositHistory(address);
  const vaultDeposit = useVaultDeposit();

  const [balance, setBalance] = useState<bigint | null>(null);
  const [isLoadingBalance, setIsLoadingBalance] = useState(false);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [activeHistoryId, setActiveHistoryId] = useState<number | null>(null);

  const loadBalance = useCallback(async () => {
    if (!address || !publicClient) return;
    setIsLoadingBalance(true);
    setBalanceError(null);

    try {
      const result = (await publicClient.readContract({
        address: GATEWAY_CONFIG.destinationUsdc as `0x${string}`,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address],
      })) as bigint;
      setBalance(result);
      setAmount(result > 0n ? formatUnits(result, 6) : "");
    } catch (error: any) {
      setBalanceError(error?.message || "Failed to load balance");
    } finally {
      setIsLoadingBalance(false);
    }
  }, [address, publicClient]);

  useEffect(() => {
    if (isConnected) {
      loadBalance();
    } else {
      setBalance(null);
      setAmount("");
    }
  }, [isConnected, loadBalance]);

  const formattedBalance = useMemo(() => {
    if (balance === null) return "—";
    return formatUnits(balance, 6);
  }, [balance]);

  const onDeposit = async () => {
    if (!amount) return;
    const parsed = parseUnits(amount, 6);
    if (balance !== null && parsed > balance) {
      setBalanceError("Insufficient USDC balance on Arc");
      return;
    }

    const timestamp = Date.now();
    setActiveHistoryId(timestamp);
    saveDeposit({
      timestamp,
      address: address as `0x${string}`,
      deposits: [],
      vaultDeposit: {
        amount: parsed,
        status: "switching",
      },
    });

    await vaultDeposit.depositToVault(parsed);
  };

  useEffect(() => {
    if (!activeHistoryId || vaultDeposit.status === "idle") return;
    const status =
      vaultDeposit.status === "error"
        ? "failed"
        : vaultDeposit.status === "approving"
          ? "approving"
          : vaultDeposit.status === "depositing"
            ? "depositing"
            : vaultDeposit.status === "switching"
              ? "switching"
              : vaultDeposit.status === "completed"
                ? "completed"
                : "pending";

    updateDeposit(activeHistoryId, {
      vaultDeposit: {
        amount: vaultDeposit.amount ?? parseUnits(amount || "0", 6),
        status,
        txHash: vaultDeposit.txHash ? (vaultDeposit.txHash as `0x${string}`) : null,
        error: vaultDeposit.error,
      },
    });
  }, [
    activeHistoryId,
    amount,
    updateDeposit,
    vaultDeposit.amount,
    vaultDeposit.error,
    vaultDeposit.status,
    vaultDeposit.txHash,
  ]);

  if (!isConnected) {
    return (
      <div className="card bg-base-100 shadow-xl">
        <div className="card-body">
          <h2 className="card-title">Direct Deposit on Arc</h2>
          <p className="text-center py-8">Connect your wallet to get started</p>
        </div>
      </div>
    );
  }

  return (
    <div className="card bg-base-100 shadow-xl max-w-2xl">
      <div className="card-body">
        <h2 className="card-title">Direct Deposit on Arc</h2>
        <p className="text-sm text-base-content/70">
          Deposit USDC directly on Arc and mint yRWA without using the gateway.
        </p>

        {chainId !== GATEWAY_CONFIG.destinationChainId && (
          <div className="alert alert-warning">
            <span>Please switch to Arc Testnet to continue. We can switch automatically when you deposit.</span>
          </div>
        )}

        <div className="flex items-center justify-between text-sm">
          <span className="opacity-70">Arc USDC balance</span>
          <div className="flex items-center gap-2">
            <span className="font-semibold">{formattedBalance}</span>
            <button className="btn btn-xs btn-ghost" type="button" onClick={loadBalance} disabled={isLoadingBalance}>
              {isLoadingBalance ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        {balanceError && (
          <div className="alert alert-error">
            <span className="text-sm">{balanceError}</span>
          </div>
        )}

        <div className="form-control w-full">
          <label className="label">
            <span className="label-text">USDC Amount</span>
            <span className="label-text-alt">Available: {formattedBalance}</span>
          </label>
          <input
            type="number"
            placeholder="0.00"
            className="input input-bordered w-full"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            min="0"
            step="0.01"
          />
        </div>

        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span>Status:</span>
            <span className="badge badge-primary">{vaultDeposit.status}</span>
          </div>
          {vaultDeposit.txHash && (
            <div className="flex justify-between text-sm">
              <span>Transaction:</span>
              <a
                href={getExplorerUrl(GATEWAY_CONFIG.destinationChainId, vaultDeposit.txHash) || "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="link link-primary"
              >
                View on Explorer
              </a>
            </div>
          )}
          {vaultDeposit.error && (
            <div className="alert alert-error">
              <span className="text-sm">{vaultDeposit.error}</span>
            </div>
          )}
        </div>

        <button
          className="btn btn-primary mt-4"
          disabled={
            !amount ||
            Number(amount) <= 0 ||
            vaultDeposit.status === "switching" ||
            vaultDeposit.status === "approving" ||
            vaultDeposit.status === "depositing"
          }
          onClick={onDeposit}
        >
          {vaultDeposit.status === "switching" && "Switching to Arc..."}
          {vaultDeposit.status === "approving" && "Approving USDC..."}
          {vaultDeposit.status === "depositing" && "Depositing to Vault..."}
          {vaultDeposit.status === "completed" && "Deposit Complete!"}
          {vaultDeposit.status === "idle" && "Deposit to Vault"}
          {vaultDeposit.status === "error" && "Try Again"}
        </button>

        {vaultDeposit.status === "completed" && (
          <div className="alert alert-success mt-4">
            <div>
              <div className="font-bold">Success!</div>
              <div className="text-sm">
                yRWA tokens minted to your wallet. Check the Vault page to view your position.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
