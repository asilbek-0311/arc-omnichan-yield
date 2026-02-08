"use client";

import { useState } from "react";
import { TransactionList } from "./TransactionList";
import { ZapProgress } from "./ZapProgress";
import { type Address, formatUnits } from "viem";
import { useAccount, useChainId, useSwitchChain } from "wagmi";
import { type ZapQuote, useZapDeposit } from "~~/hooks/useZapDeposit";
import { LIFI_CHAIN_IDS, type SupportedChainKey } from "~~/lib/lifi-config";
import { notification } from "~~/utils/scaffold-eth";

type ChainOption = {
  key: SupportedChainKey;
  label: string;
  icon: string;
};

const CHAIN_OPTIONS: ChainOption[] = [
  { key: "sepolia", label: "Sepolia", icon: "🔷" },
  { key: "baseSepolia", label: "Base Sepolia", icon: "🔵" },
  { key: "avalancheFuji", label: "Avalanche Fuji", icon: "🔺" },
];

export const OneClickZap = () => {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { state, getQuote, executeZap, reset } = useZapDeposit();

  const [sourceChain, setSourceChain] = useState<SupportedChainKey>("sepolia");
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<ZapQuote | null>(null);
  const [isSwitchingChain, setIsSwitchingChain] = useState(false);

  const handleGetQuote = async () => {
    if (!amount || parseFloat(amount) <= 0) {
      return;
    }

    try {
      // For now, we'll only support USDC deposits (no swap)
      // In production, add token selector for multi-token support
      const usdcAddresses: Record<SupportedChainKey, Address> = {
        sepolia: process.env.NEXT_PUBLIC_USDC_SEPOLIA as Address,
        baseSepolia: process.env.NEXT_PUBLIC_USDC_BASE_SEPOLIA as Address,
        avalancheFuji: process.env.NEXT_PUBLIC_USDC_AVAX_FUJI as Address,
      };

      const quoteResult = await getQuote({
        sourceChain,
        sourceToken: usdcAddresses[sourceChain],
        amount,
      });

      setQuote(quoteResult);
    } catch (error) {
      console.error("Failed to get quote:", error);
    }
  };

  const handleExecute = async () => {
    if (!quote) return;
    await executeZap(quote);
  };

  const handleReset = () => {
    reset();
    setQuote(null);
    setAmount("");
  };

  const handleChainChange = async (newChain: SupportedChainKey) => {
    setSourceChain(newChain);

    // Auto-switch to the selected chain
    const targetChainId = LIFI_CHAIN_IDS[newChain];
    if (chainId !== targetChainId && !isSwitchingChain) {
      try {
        setIsSwitchingChain(true);
        await switchChainAsync({ chainId: targetChainId });
        notification.success(`Switched to ${CHAIN_OPTIONS.find(c => c.key === newChain)?.label}`);
      } catch (error) {
        console.error("Failed to switch chain:", error);
        notification.warning("Please manually switch to the selected chain");
      } finally {
        setIsSwitchingChain(false);
      }
    }
  };

  if (!isConnected) {
    return (
      <div className="card bg-base-100 shadow-xl">
        <div className="card-body">
          <h2 className="card-title">One-Click Zap to Arc Vault</h2>
          <p className="text-center py-8">Connect your wallet to get started</p>
        </div>
      </div>
    );
  }

  return (
    <div className="card bg-base-100 shadow-xl max-w-2xl mx-auto">
      <div className="card-body">
        <h2 className="card-title">Deposit to Arc Vault</h2>
        <p className="text-sm text-base-content/70">
          Deposit USDC from any supported chain. Your USDC will be automatically bridged to Arc and deposited into the
          vault.
        </p>
        <div className="alert alert-info text-xs">
          <span>💡 Currently supports USDC deposits only. Multi-token support coming soon!</span>
        </div>

        {state.status === "idle" || state.status === "quoting" ? (
          <>
            {/* Source Chain Selector */}
            <div className="form-control w-full">
              <label className="label">
                <span className="label-text">Source Chain</span>
              </label>
              <select
                className="select select-bordered w-full"
                value={sourceChain}
                onChange={e => handleChainChange(e.target.value as SupportedChainKey)}
                disabled={state.status === "quoting" || isSwitchingChain}
              >
                {CHAIN_OPTIONS.map(chain => (
                  <option key={chain.key} value={chain.key}>
                    {chain.icon} {chain.label}
                  </option>
                ))}
              </select>
              {isSwitchingChain && (
                <label className="label">
                  <span className="label-text-alt flex items-center gap-2">
                    <span className="loading loading-spinner loading-xs"></span>
                    Switching chain...
                  </span>
                </label>
              )}
            </div>

            {/* Amount Input */}
            <div className="form-control w-full">
              <label className="label">
                <span className="label-text">USDC Amount</span>
              </label>
              <input
                type="number"
                placeholder="0.00"
                className="input input-bordered w-full"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                disabled={state.status === "quoting"}
                min="0"
                step="0.01"
              />
              <label className="label">
                <span className="label-text-alt text-base-content/50">Minimum: 1 USDC</span>
              </label>
            </div>

            {/* Quote Display */}
            {quote && (
              <div className="alert alert-info">
                <div className="flex flex-col gap-1 w-full">
                  <div className="flex justify-between">
                    <span>You will receive:</span>
                    <span className="font-bold">{formatUnits(quote.estimatedYRWA, 6)} yRWA</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Estimated time:</span>
                    <span>{Math.ceil(quote.estimatedTime / 60)} minutes</span>
                  </div>
                  {quote.needsSwap && (
                    <div className="text-xs mt-1">
                      <span className="badge badge-warning badge-sm">Includes token swap</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="card-actions justify-end gap-2 mt-4">
              {!quote ? (
                <button
                  className={`btn btn-primary ${state.status === "quoting" ? "loading" : ""}`}
                  onClick={handleGetQuote}
                  disabled={!amount || parseFloat(amount) <= 0 || state.status === "quoting"}
                >
                  {state.status === "quoting" ? "Getting Quote..." : "Get Quote"}
                </button>
              ) : (
                <>
                  <button className="btn btn-ghost" onClick={handleReset}>
                    Reset
                  </button>
                  <button className="btn btn-primary" onClick={handleExecute}>
                    Execute Zap
                  </button>
                </>
              )}
            </div>
          </>
        ) : (
          <>
            {/* Progress Indicator */}
            <ZapProgress state={state} />

            {/* Transaction History */}
            <TransactionList transactions={state.transactions} />

            {(state.status === "completed" || state.status === "failed") && (
              <div className="card-actions justify-end mt-4">
                <button className="btn btn-primary" onClick={handleReset}>
                  Start New Zap
                </button>
              </div>
            )}
          </>
        )}

        {/* Help Text */}
        <div className="divider"></div>
        <div className="text-xs text-base-content/50">
          <p className="mb-2">How it works:</p>
          <ol className="list-decimal list-inside space-y-1">
            <li>Deposit USDC to Circle Gateway on your selected chain</li>
            <li>Sign the burn intent and submit the Gateway transfer</li>
            <li>Gateway mints USDC on Arc and deposits to the vault</li>
            <li>You receive yRWA tokens representing your vault share</li>
          </ol>
        </div>
      </div>
    </div>
  );
};
