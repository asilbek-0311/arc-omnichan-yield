"use client";

import { type TransactionRecord } from "~~/hooks/useZapDeposit";

type TransactionListProps = {
  transactions: TransactionRecord[];
};

// Map chain IDs to chain names and explorer URLs
const CHAIN_INFO: Record<number, { name: string; explorer: string }> = {
  11155111: { name: "Sepolia", explorer: "https://sepolia.etherscan.io" },
  421614: { name: "Arbitrum Sepolia", explorer: "https://sepolia.arbiscan.io" },
  84532: { name: "Base Sepolia", explorer: "https://sepolia.basescan.org" },
  43113: { name: "Avalanche Fuji", explorer: "https://testnet.snowtrace.io" },
  5042002: { name: "Arc Testnet", explorer: "https://testnet.arcscan.io" },
};

export const TransactionList = ({ transactions }: TransactionListProps) => {
  if (transactions.length === 0) {
    return null;
  }

  return (
    <div className="mt-4">
      <div className="divider">Transaction History</div>
      <div className="space-y-2">
        {transactions.map((tx, index) => {
          const chainInfo = CHAIN_INFO[tx.chainId];
          const explorerUrl = chainInfo ? `${chainInfo.explorer}/tx/${tx.hash}` : null;

          return (
            <div key={`${tx.hash}-${index}`} className="flex items-center justify-between bg-base-200 p-3 rounded-lg">
              <div className="flex-1">
                <div className="font-medium text-sm">{tx.step}</div>
                <div className="text-xs text-base-content/60">
                  {chainInfo?.name || `Chain ${tx.chainId}`} • {new Date(tx.timestamp).toLocaleTimeString()}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="text-xs font-mono text-base-content/60">
                  {tx.hash.slice(0, 6)}...{tx.hash.slice(-4)}
                </div>
                {explorerUrl && (
                  <a href={explorerUrl} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-xs">
                    View ↗
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
