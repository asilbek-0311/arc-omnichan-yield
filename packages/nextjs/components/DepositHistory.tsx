"use client";

import { formatUnits } from "viem";
import { useAccount } from "wagmi";
import { useDepositHistory } from "~~/hooks/useDepositHistory";

const getExplorerUrl = (chainId: number, txHash: string) => {
  const explorers: Record<number, string> = {
    11155111: "https://sepolia.etherscan.io/tx/",
    43113: "https://testnet.snowtrace.io/tx/",
    84532: "https://sepolia.basescan.org/tx/",
    5042002: "https://testnet.arcscan.app/tx/",
  };
  return explorers[chainId] ? `${explorers[chainId]}${txHash}` : null;
};

export const DepositHistory = () => {
  const { address } = useAccount();
  const { history } = useDepositHistory(address);

  const getVaultStatusBadge = (status: string) => {
    if (status === "completed") return "badge-success";
    if (status === "failed") return "badge-error";
    if (status === "pending") return "badge-warning";
    return "badge-primary";
  };

  return (
    <div className="card bg-base-100 shadow-xl">
      <div className="card-body">
        <h2 className="card-title">Recent Deposits</h2>
        {history.length === 0 && (
          <p className="text-sm opacity-70">No Arc deposits yet. Complete a direct deposit to see it here.</p>
        )}
        <div className="space-y-3 max-h-96 overflow-y-auto">
          {history.map((entry, idx) => (
            <div key={idx} className="rounded-lg bg-base-200 p-4">
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm opacity-70">{new Date(entry.timestamp).toLocaleString()}</span>
                {entry.vaultDeposit?.status === "completed" && <span className="badge badge-success">Complete</span>}
                {entry.vaultDeposit?.status === "pending" && <span className="badge badge-warning">Pending</span>}
                {entry.vaultDeposit?.status === "failed" && <span className="badge badge-error">Failed</span>}
                {entry.vaultDeposit && !["completed", "pending", "failed"].includes(entry.vaultDeposit.status) && (
                  <span className="badge badge-primary">{entry.vaultDeposit.status}</span>
                )}
                {!entry.vaultDeposit && <span className="badge badge-info">Gateway Only</span>}
              </div>
              <div className="space-y-1">
                {entry.deposits.map(d => (
                  <div key={d.chainKey} className="flex justify-between text-sm items-center">
                    <span>
                      {d.chainKey}: {formatUnits(d.amount, 6)} USDC
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="badge badge-sm">{d.status}</span>
                      {d.txHash && (
                        <a
                          href={getExplorerUrl(d.chainId, d.txHash) || "#"}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="link link-primary text-xs"
                        >
                          View Tx
                        </a>
                      )}
                    </div>
                  </div>
                ))}
                {entry.vaultDeposit && (
                  <div className="flex justify-between text-sm items-center mt-2 pt-2 border-t border-base-300">
                    <span>Vault: {formatUnits(entry.vaultDeposit.amount, 6)} USDC</span>
                    <div className="flex items-center gap-2">
                      <span className={`badge badge-sm ${getVaultStatusBadge(entry.vaultDeposit.status)}`}>
                        {entry.vaultDeposit.status}
                      </span>
                      {entry.vaultDeposit.txHash && (
                        <a
                          href={getExplorerUrl(5042002, entry.vaultDeposit.txHash) || "#"}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="link link-primary text-xs"
                        >
                          View Vault Tx
                        </a>
                      )}
                    </div>
                  </div>
                )}
                {entry.vaultDeposit?.error && (
                  <div className="alert alert-error text-xs p-2 mt-2">
                    <span>{entry.vaultDeposit.error}</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
