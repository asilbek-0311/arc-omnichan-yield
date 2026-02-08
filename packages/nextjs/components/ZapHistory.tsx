"use client";

import { formatUnits } from "viem";
import { useAccount } from "wagmi";
import { useZapHistory } from "~~/hooks/useDepositHistory";
import { getBlockExplorerTxLink } from "~~/utils/scaffold-eth";

const getChainName = (chainKey: string): string => {
  const names: Record<string, string> = {
    sepolia: "Sepolia",
    baseSepolia: "Base Sepolia",
    avalancheFuji: "Avalanche Fuji",
  };
  return names[chainKey] || chainKey;
};

export const ZapHistory = () => {
  const { address } = useAccount();
  const { zapHistory } = useZapHistory(address);

  if (zapHistory.length === 0) {
    return (
      <div className="card bg-base-100 shadow-xl">
        <div className="card-body">
          <h2 className="card-title">Zap History</h2>
          <p className="text-sm opacity-70">No zap deposits yet. Complete your first zap to see it here!</p>
        </div>
      </div>
    );
  }

  return (
    <div className="card bg-base-100 shadow-xl">
      <div className="card-body">
        <h2 className="card-title">Zap History</h2>
        <div className="space-y-3 max-h-96 overflow-y-auto">
          {zapHistory.map(entry => (
            <div key={entry.timestamp} className="rounded-lg bg-base-200 p-4">
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm opacity-70">{new Date(entry.timestamp).toLocaleString()}</span>
                {entry.status === "completed" && <span className="badge badge-success">Complete</span>}
                {entry.status === "pending" && <span className="badge badge-warning">Pending</span>}
                {entry.status === "failed" && <span className="badge badge-error">Failed</span>}
              </div>

              <div className="space-y-2">
                {/* Source Chain & Amount */}
                <div className="flex justify-between text-sm">
                  <span className="opacity-70">From:</span>
                  <span className="font-medium">
                    {getChainName(entry.sourceChain)} - {formatUnits(entry.sourceAmount, 6)} USDC
                  </span>
                </div>

                {/* Estimated yRWA */}
                <div className="flex justify-between text-sm">
                  <span className="opacity-70">Expected yRWA:</span>
                  <span className="font-medium">{formatUnits(entry.estimatedYRWA, 6)}</span>
                </div>

                {/* Swap indicator */}
                {entry.needsSwap && (
                  <div className="flex justify-between text-sm">
                    <span className="badge badge-sm badge-info">Token swapped to USDC</span>
                  </div>
                )}

                {/* Transaction link */}
                {entry.txHash && (
                  <div className="flex justify-end">
                    <a
                      href={getBlockExplorerTxLink(entry.sourceChainId, entry.txHash)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="link link-primary text-xs"
                    >
                      View Gateway Tx →
                    </a>
                  </div>
                )}

                {/* Error message */}
                {entry.error && (
                  <div className="alert alert-error text-xs p-2 mt-2">
                    <span>{entry.error}</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {zapHistory.length > 0 && (
          <div className="divider text-xs opacity-50">Showing {zapHistory.length} recent zaps</div>
        )}
      </div>
    </div>
  );
};
