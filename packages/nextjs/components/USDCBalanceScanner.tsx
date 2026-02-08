"use client";

import { useEffect, useMemo, useState } from "react";
import { createPublicClient, formatUnits, http } from "viem";
import * as chains from "viem/chains";
import { useAccount } from "wagmi";
import { GATEWAY_CHAINS, GATEWAY_CONFIG, type GatewayChainKey } from "~~/lib/gateway-config";

const erc20BalanceAbi = [
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

const chainMap = {
  sepolia: chains.sepolia,
  avalancheFuji: chains.avalancheFuji,
  baseSepolia: chains.baseSepolia,
} as const;

type BalanceRow = {
  chainKey: GatewayChainKey;
  chainName: string;
  chainId: number;
  balance: bigint;
  formatted: string;
  selected: boolean;
};

type Props = {
  onSelectionChange?: (rows: BalanceRow[]) => void;
};

export const USDCBalanceScanner = ({ onSelectionChange }: Props) => {
  const { address } = useAccount();
  const [rows, setRows] = useState<BalanceRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const fetchBalances = async () => {
      if (!address) {
        setRows([]);
        return;
      }
      setIsLoading(true);

      const balances = await Promise.all(
        GATEWAY_CHAINS.map(async chainKey => {
          const chain = chainMap[chainKey];
          const client = createPublicClient({
            chain,
            transport: http(chain.rpcUrls.default.http[0]),
          });
          const usdcAddress = GATEWAY_CONFIG.usdc[chainKey];
          const balance = (await client.readContract({
            address: usdcAddress,
            abi: erc20BalanceAbi,
            functionName: "balanceOf",
            args: [address],
          })) as bigint;
          return {
            chainKey,
            chainName: chain.name,
            chainId: GATEWAY_CONFIG.chainIds[chainKey],
            balance,
            formatted: formatUnits(balance, 6),
            selected: balance > 0n,
          };
        }),
      );

      if (isMounted) {
        setRows(balances);
        onSelectionChange?.(balances);
        setIsLoading(false);
      }
    };

    fetchBalances();

    return () => {
      isMounted = false;
    };
  }, [address, onSelectionChange]);

  const total = useMemo(() => rows.reduce((sum, row) => sum + Number(row.formatted), 0), [rows]);

  const toggleAll = (checked: boolean) => {
    const updated = rows.map(row => ({ ...row, selected: checked && row.balance > 0n }));
    setRows(updated);
    onSelectionChange?.(updated);
  };

  const toggleRow = (chainKey: GatewayChainKey) => {
    const updated = rows.map(row => (row.chainKey === chainKey ? { ...row, selected: !row.selected } : row));
    setRows(updated);
    onSelectionChange?.(updated);
  };

  return (
    <div className="card bg-base-100 shadow-xl">
      <div className="card-body">
        <div className="flex items-center justify-between">
          <h2 className="card-title">Your USDC Holdings</h2>
          <label className="label cursor-pointer gap-2">
            <span className="label-text">Select All</span>
            <input type="checkbox" className="checkbox" onChange={e => toggleAll(e.target.checked)} />
          </label>
        </div>
        {isLoading ? (
          <div className="flex items-center gap-2">
            <span className="loading loading-spinner"></span>
            <span>Scanning chains...</span>
          </div>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              {rows.map(row => (
                <div
                  key={row.chainKey}
                  className={`flex items-center justify-between rounded-xl p-4 ${
                    row.balance === 0n ? "bg-base-200 opacity-50" : "bg-base-200"
                  }`}
                >
                  <div>
                    <div className="font-semibold">{row.chainName}</div>
                    <div className="text-sm opacity-70">{row.formatted} USDC</div>
                  </div>
                  <input
                    type="checkbox"
                    className="checkbox"
                    disabled={row.balance === 0n}
                    checked={row.selected}
                    onChange={() => toggleRow(row.chainKey)}
                  />
                </div>
              ))}
            </div>
            {total === 0 && (
              <div className="alert alert-warning mt-4">
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
                <span>
                  No USDC detected on any supported chains. Please acquire USDC on Sepolia, Base Sepolia, or Avalanche
                  Fuji to continue.
                </span>
              </div>
            )}
          </>
        )}
        <div className="mt-4 text-right text-sm opacity-70">Total detected: {total.toFixed(2)} USDC</div>
      </div>
    </div>
  );
};
