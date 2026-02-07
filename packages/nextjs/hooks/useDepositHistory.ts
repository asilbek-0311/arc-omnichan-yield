import { useCallback, useEffect, useState } from "react";
import type { ChainDepositState } from "./useMultiChainDeposit";
import type { Address, Hex } from "viem";

export type DepositHistoryEntry = {
  timestamp: number;
  address: Address;
  deposits: ChainDepositState[];
  vaultDeposit?: {
    txHash?: Hex | null;
    amount: bigint;
    status: "switching" | "approving" | "depositing" | "pending" | "completed" | "failed";
    error?: string;
  };
};

export type ZapHistoryEntry = {
  timestamp: number;
  address: Address;
  sourceChain: string;
  sourceChainId: number;
  sourceToken: Address;
  sourceAmount: bigint;
  estimatedYRWA: bigint;
  txHash: Hex | null;
  status: "pending" | "completed" | "failed";
  error?: string;
  needsSwap: boolean;
};

// BigInt serialization helpers
const replaceBigInts = (key: string, value: any) => {
  if (typeof value === "bigint") {
    return { __type: "bigint", value: value.toString() };
  }
  return value;
};

const reviveBigInts = (key: string, value: any) => {
  if (value && typeof value === "object" && value.__type === "bigint") {
    return BigInt(value.value);
  }
  return value;
};

export const useDepositHistory = (address?: Address) => {
  const [history, setHistory] = useState<DepositHistoryEntry[]>([]);

  // Load from localStorage on mount
  useEffect(() => {
    if (!address) return;
    const key = `deposit-history-${address}`;
    const stored = localStorage.getItem(key);
    if (stored) {
      try {
        setHistory(JSON.parse(stored, reviveBigInts));
      } catch (err) {
        console.error("Failed to load deposit history:", err);
        setHistory([]);
      }
    }
  }, [address]);

  // Save deposit entry
  const saveDeposit = useCallback(
    (entry: DepositHistoryEntry) => {
      if (!address) return;
      const updated = [entry, ...history]; // Keep all deposits (unlimited)
      setHistory(updated);
      try {
        localStorage.setItem(`deposit-history-${address}`, JSON.stringify(updated, replaceBigInts));
      } catch {
        // If localStorage is full, remove oldest 50% and try again
        const truncated = updated.slice(0, Math.floor(updated.length / 2));
        try {
          localStorage.setItem(`deposit-history-${address}`, JSON.stringify(truncated, replaceBigInts));
          console.warn("localStorage full, truncated oldest 50% of history");
        } catch (innerErr) {
          console.error("Failed to save deposit history even after truncation:", innerErr);
        }
      }
    },
    [address, history],
  );

  const updateDeposit = useCallback(
    (timestamp: number, updates: Partial<DepositHistoryEntry>) => {
      if (!address) return;
      const updated = history.map(entry => (entry.timestamp === timestamp ? { ...entry, ...updates } : entry));
      setHistory(updated);
      try {
        localStorage.setItem(`deposit-history-${address}`, JSON.stringify(updated, replaceBigInts));
      } catch (err) {
        console.error("Failed to update deposit history:", err);
      }
    },
    [address, history],
  );

  return { history, saveDeposit, updateDeposit };
};

/**
 * Hook for tracking zap deposit history
 */
export const useZapHistory = (address?: Address) => {
  const [zapHistory, setZapHistory] = useState<ZapHistoryEntry[]>([]);

  // Load from localStorage on mount
  useEffect(() => {
    if (!address) return;
    const key = `zap-history-${address}`;
    const stored = localStorage.getItem(key);
    if (stored) {
      try {
        setZapHistory(JSON.parse(stored, reviveBigInts));
      } catch (err) {
        console.error("Failed to load zap history:", err);
        setZapHistory([]);
      }
    }
  }, [address]);

  // Save zap entry
  const saveZap = useCallback(
    (entry: ZapHistoryEntry) => {
      if (!address) return;
      const updated = [entry, ...zapHistory].slice(0, 50); // Keep last 50 zaps
      setZapHistory(updated);
      try {
        localStorage.setItem(`zap-history-${address}`, JSON.stringify(updated, replaceBigInts));
      } catch (err) {
        console.error("Failed to save zap history:", err);
      }
    },
    [address, zapHistory],
  );

  // Update existing zap entry
  const updateZap = useCallback(
    (timestamp: number, updates: Partial<ZapHistoryEntry>) => {
      if (!address) return;
      const updated = zapHistory.map(entry => (entry.timestamp === timestamp ? { ...entry, ...updates } : entry));
      setZapHistory(updated);
      try {
        localStorage.setItem(`zap-history-${address}`, JSON.stringify(updated, replaceBigInts));
      } catch (err) {
        console.error("Failed to update zap history:", err);
      }
    },
    [address, zapHistory],
  );

  return { zapHistory, saveZap, updateZap };
};
