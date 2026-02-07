"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatUnits, parseUnits } from "viem";
import type { Address } from "viem";
import { useAccount, usePublicClient, useSwitchChain, useWalletClient } from "wagmi";
import { USYC_CONFIG } from "~~/lib/usyc-config";
import { notification } from "~~/utils/scaffold-eth";

type TreasuryStatus = "idle" | "switching" | "approving" | "depositing" | "redeeming" | "completed" | "error";

type TreasuryHistoryEntry = {
  timestamp: number;
  type: "deposit" | "redeem";
  amount: string;
  status: TreasuryStatus;
  txHash?: `0x${string}` | null;
  error?: string;
};

const erc20Abi = [
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

const tellerAbi = [
  {
    inputs: [
      { name: "_assets", type: "uint256" },
      { name: "_receiver", type: "address" },
    ],
    name: "deposit",
    outputs: [{ name: "shares", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "_shares", type: "uint256" },
      { name: "_receiver", type: "address" },
      { name: "_account", type: "address" },
    ],
    name: "redeem",
    outputs: [{ name: "assets", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

const HISTORY_KEY = (address: Address) => `usyc-history-${address}`;

export const useUscyTreasury = () => {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: USYC_CONFIG.chainId });
  const { data: walletClient } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();

  const [status, setStatus] = useState<TreasuryStatus>("idle");
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [usdcBalance, setUsdcBalance] = useState<bigint | null>(null);
  const [usycBalance, setUsycBalance] = useState<bigint | null>(null);
  const [history, setHistory] = useState<TreasuryHistoryEntry[]>([]);

  const loadHistory = useCallback(() => {
    if (!address) return;
    const stored = localStorage.getItem(HISTORY_KEY(address));
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored) as TreasuryHistoryEntry[];
      setHistory(parsed);
    } catch (err) {
      console.error("Failed to load USYC history:", err);
      setHistory([]);
    }
  }, [address]);

  const persistHistory = useCallback(
    (entries: TreasuryHistoryEntry[]) => {
      if (!address) return;
      setHistory(entries);
      try {
        localStorage.setItem(HISTORY_KEY(address), JSON.stringify(entries));
      } catch (err) {
        console.error("Failed to save USYC history:", err);
      }
    },
    [address],
  );

  useEffect(() => {
    if (address) {
      loadHistory();
    }
  }, [address, loadHistory]);

  const refreshBalances = useCallback(async () => {
    if (!address || !publicClient) return;
    try {
      const [usdc, usyc] = await Promise.all([
        publicClient.readContract({
          address: USYC_CONFIG.usdc,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address],
        }),
        publicClient.readContract({
          address: USYC_CONFIG.usycToken,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address],
        }),
      ]);
      setUsdcBalance(usdc as bigint);
      setUsycBalance(usyc as bigint);
    } catch (err) {
      console.error("Failed to load balances:", err);
    }
  }, [address, publicClient]);

  useEffect(() => {
    refreshBalances();
  }, [refreshBalances]);

  const ensureArcNetwork = useCallback(async () => {
    if (!walletClient) throw new Error("Wallet not connected");
    const currentChainId = await walletClient.getChainId();
    if (currentChainId !== USYC_CONFIG.chainId) {
      setStatus("switching");
      await switchChainAsync({ chainId: USYC_CONFIG.chainId });
    }
  }, [switchChainAsync, walletClient]);

  const appendHistory = useCallback(
    (entry: TreasuryHistoryEntry) => {
      const updated = [entry, ...history].slice(0, 50);
      persistHistory(updated);
    },
    [history, persistHistory],
  );

  const updateHistory = useCallback(
    (timestamp: number, updates: Partial<TreasuryHistoryEntry>) => {
      const updated = history.map(entry => (entry.timestamp === timestamp ? { ...entry, ...updates } : entry));
      persistHistory(updated);
    },
    [history, persistHistory],
  );

  const deposit = useCallback(
    async (amount: string) => {
      if (!address || !walletClient || !publicClient) {
        notification.error("Wallet not connected");
        return;
      }
      setError(null);
      setTxHash(null);
      const timestamp = Date.now();
      appendHistory({ timestamp, type: "deposit", amount, status: "approving" });

      try {
        await ensureArcNetwork();
        setStatus("approving");

        const parsed = parseUnits(amount, 6);
        await walletClient.writeContract({
          address: USYC_CONFIG.usdc,
          abi: erc20Abi,
          functionName: "approve",
          args: [USYC_CONFIG.teller, parsed],
          chain: walletClient.chain,
          account: address,
        });

        setStatus("depositing");
        const hash = await walletClient.writeContract({
          address: USYC_CONFIG.teller,
          abi: tellerAbi,
          functionName: "deposit",
          args: [parsed, address],
          chain: walletClient.chain,
          account: address,
        });
        setTxHash(hash);
        updateHistory(timestamp, { status: "depositing", txHash: hash });

        await publicClient.waitForTransactionReceipt({ hash });
        setStatus("completed");
        updateHistory(timestamp, { status: "completed", txHash: hash });
        notification.success(`Deposited ${amount} USDC into USYC`);
        refreshBalances();
        setTimeout(() => setStatus("idle"), 1500);
      } catch (err: any) {
        const message = err?.message || "Deposit failed";
        setStatus("error");
        setError(message);
        updateHistory(timestamp, { status: "error", error: message });
        notification.error(message);
      }
    },
    [address, appendHistory, ensureArcNetwork, publicClient, refreshBalances, updateHistory, walletClient],
  );

  const redeem = useCallback(
    async (amount: string) => {
      if (!address || !walletClient || !publicClient) {
        notification.error("Wallet not connected");
        return;
      }
      setError(null);
      setTxHash(null);
      const timestamp = Date.now();
      appendHistory({ timestamp, type: "redeem", amount, status: "approving" });

      try {
        await ensureArcNetwork();
        setStatus("approving");

        const parsed = parseUnits(amount, 6);
        await walletClient.writeContract({
          address: USYC_CONFIG.usycToken,
          abi: erc20Abi,
          functionName: "approve",
          args: [USYC_CONFIG.teller, parsed],
          chain: walletClient.chain,
          account: address,
        });

        setStatus("redeeming");
        const hash = await walletClient.writeContract({
          address: USYC_CONFIG.teller,
          abi: tellerAbi,
          functionName: "redeem",
          args: [parsed, address, address],
          chain: walletClient.chain,
          account: address,
        });
        setTxHash(hash);
        updateHistory(timestamp, { status: "redeeming", txHash: hash });

        await publicClient.waitForTransactionReceipt({ hash });
        setStatus("completed");
        updateHistory(timestamp, { status: "completed", txHash: hash });
        notification.success(`Redeemed ${amount} USYC to USDC`);
        refreshBalances();
        setTimeout(() => setStatus("idle"), 1500);
      } catch (err: any) {
        const message = err?.message || "Redeem failed";
        setStatus("error");
        setError(message);
        updateHistory(timestamp, { status: "error", error: message });
        notification.error(message);
      }
    },
    [address, appendHistory, ensureArcNetwork, publicClient, refreshBalances, updateHistory, walletClient],
  );

  const formattedUsdc = useMemo(() => (usdcBalance ? formatUnits(usdcBalance, 6) : "0.00"), [usdcBalance]);
  const formattedUscy = useMemo(() => (usycBalance ? formatUnits(usycBalance, 6) : "0.00"), [usycBalance]);

  return {
    status,
    txHash,
    error,
    usdcBalance,
    usycBalance,
    formattedUsdc,
    formattedUscy,
    history,
    refreshBalances,
    deposit,
    redeem,
  };
};
