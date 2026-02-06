"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatUnits, parseUnits } from "viem";
import { useAccount, useChainId } from "wagmi";
import { USDCBalanceScanner } from "~~/components/USDCBalanceScanner";
import { useGatewayBalance } from "~~/hooks/useGatewayBalance";
import { useMultiChainDeposit } from "~~/hooks/useMultiChainDeposit";
import { useVaultDeposit } from "~~/hooks/useVaultDeposit";
import { GATEWAY_CONFIG, type GatewayChainKey } from "~~/lib/gateway-config";

type SelectedRow = {
  chainKey: GatewayChainKey;
  balance: bigint;
  selected: boolean;
};

const getExplorerUrl = (chainId: number, txHash: string) => {
  const explorers: Record<number, string> = {
    11155111: "https://sepolia.etherscan.io/tx/",
    43113: "https://testnet.snowtrace.io/tx/",
    84532: "https://sepolia.basescan.org/tx/",
    421614: "https://sepolia.arbiscan.io/tx/",
    5042002: "https://testnet.arcscan.xyz/tx/",
  };
  return explorers[chainId] ? `${explorers[chainId]}${txHash}` : null;
};

export const GatewayDeposit = () => {
  const { address } = useAccount();
  const chainId = useChainId();
  const { data: gatewayBalance } = useGatewayBalance(address);
  const { summary, startDeposit } = useMultiChainDeposit();
  const vaultDeposit = useVaultDeposit();
  const [selectedRows, setSelectedRows] = useState<SelectedRow[]>([]);
  const [depositAmount, setDepositAmount] = useState("");

  const handleSelectionChange = useCallback((rows: SelectedRow[]) => {
    setSelectedRows(rows.map(row => ({ chainKey: row.chainKey, balance: row.balance, selected: row.selected })));
  }, []);

  const selected = useMemo(() => selectedRows.filter(row => row.selected && row.balance > 0n), [selectedRows]);

  const onDeposit = async () => {
    if (selected.length === 0) return;
    await startDeposit(selected.map(row => ({ chainKey: row.chainKey, amount: row.balance })));
  };

  const arcBalance = useMemo(() => {
    if (!gatewayBalance) return null;
    const arcBalanceItem = gatewayBalance.balances.find(b => b.chainId === GATEWAY_CONFIG.destinationChainId);
    return arcBalanceItem ? BigInt(arcBalanceItem.balance) : 0n;
  }, [gatewayBalance]);

  const hasGatewayDeposits = useMemo(() => {
    return summary.some(s => s.status === "finality");
  }, [summary]);

  const onVaultDeposit = async () => {
    if (!depositAmount || !arcBalance) return;
    const amount = parseUnits(depositAmount, 6);
    if (amount > arcBalance) {
      alert("Insufficient USDC balance on Arc testnet");
      return;
    }
    await vaultDeposit.depositToVault(amount);
  };

  useEffect(() => {
    if (arcBalance && arcBalance > 0n) {
      setDepositAmount(formatUnits(arcBalance, 6));
    }
  }, [arcBalance]);

  return (
    <div className="space-y-6">
      {/* Step 1: Select chains and deposit to gateway */}
      <div className="card bg-base-100 shadow-xl">
        <div className="card-body">
          <h2 className="card-title">Step 1: Select Chains & Deposit to Gateway</h2>
          <USDCBalanceScanner onSelectionChange={handleSelectionChange} />
          <button className="btn btn-primary mt-4" disabled={selected.length === 0} onClick={onDeposit}>
            Deposit to Gateway
          </button>
        </div>
      </div>

      {/* Step 2: Gateway deposit status */}
      <div className="card bg-base-100 shadow-xl">
        <div className="card-body">
          <h2 className="card-title">Step 2: Gateway Deposit Status</h2>
          <div className="space-y-2">
            {summary
              .filter(row => row.amount > 0n)
              .map(row => (
                <div key={row.chainKey} className="flex items-center justify-between rounded-lg bg-base-200 px-4 py-2">
                  <div>
                    <div className="font-semibold">{row.chainKey}</div>
                    <div className="text-xs opacity-70">{formatUnits(row.amount, 6)} USDC</div>
                  </div>
                  <div className="text-right">
                    <div className="badge badge-primary">{row.status}</div>
                    {row.txHash && (
                      <a
                        href={getExplorerUrl(row.chainId, row.txHash) || "#"}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="link link-primary mt-1 block text-xs"
                      >
                        View Tx
                      </a>
                    )}
                  </div>
                </div>
              ))}
            {summary.every(s => s.amount === 0n) && <div className="text-sm opacity-70">No deposits initiated yet</div>}
          </div>
        </div>
      </div>

      {/* Step 3: Gateway balance (bridged USDC) */}
      <div className="card bg-base-100 shadow-xl">
        <div className="card-body">
          <h2 className="card-title">Step 3: Bridged USDC on Arc Testnet</h2>
          {gatewayBalance ? (
            <div className="space-y-2">
              {gatewayBalance.balances.map(balance => (
                <div
                  key={`${balance.chainId}-${balance.token}`}
                  className="flex justify-between rounded-lg bg-base-200 px-4 py-2"
                >
                  <span className="font-medium">
                    {balance.chainId === GATEWAY_CONFIG.destinationChainId ? "Arc Testnet" : `Chain ${balance.chainId}`}
                  </span>
                  <span className="font-semibold">{formatUnits(BigInt(balance.balance), 6)} USDC</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm opacity-70">Waiting for gateway balances...</div>
          )}
          {hasGatewayDeposits && !arcBalance && (
            <div className="alert alert-info mt-4">
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
              <span>Waiting for Circle Gateway to bridge your USDC to Arc testnet. This may take a few minutes.</span>
            </div>
          )}
        </div>
      </div>

      {/* Step 4: Deposit to vault on Arc */}
      {arcBalance && arcBalance > 0n && (
        <div className="card bg-base-100 shadow-xl">
          <div className="card-body">
            <h2 className="card-title">Step 4: Deposit to Vault & Mint yRWA</h2>
            <div className="alert alert-success">
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
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <span>USDC successfully bridged to Arc testnet! Ready to deposit to vault.</span>
            </div>

            <div className="form-control">
              <label className="label">
                <span className="label-text">Amount to deposit (USDC)</span>
                <span className="label-text-alt">Available: {formatUnits(arcBalance, 6)}</span>
              </label>
              <input
                type="number"
                placeholder="Enter amount"
                className="input input-bordered"
                value={depositAmount}
                onChange={e => setDepositAmount(e.target.value)}
                step="0.01"
                min="0"
                max={formatUnits(arcBalance, 6)}
              />
            </div>

            {chainId !== GATEWAY_CONFIG.destinationChainId && (
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
                <span>Please switch to Arc Testnet to continue</span>
              </div>
            )}

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
                !depositAmount ||
                Number(depositAmount) <= 0 ||
                vaultDeposit.status === "switching" ||
                vaultDeposit.status === "approving" ||
                vaultDeposit.status === "depositing"
              }
              onClick={onVaultDeposit}
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
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
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
      )}
    </div>
  );
};
