"use client";

import { useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { USDCBalanceScanner } from "~~/components/USDCBalanceScanner";
import { useGatewayBalance } from "~~/hooks/useGatewayBalance";
import { useMultiChainDeposit } from "~~/hooks/useMultiChainDeposit";
import type { GatewayChainKey } from "~~/lib/gateway-config";

type SelectedRow = {
  chainKey: GatewayChainKey;
  balance: bigint;
  selected: boolean;
};

export const GatewayDeposit = () => {
  const { address } = useAccount();
  const { data: gatewayBalance } = useGatewayBalance(address);
  const { summary, startDeposit } = useMultiChainDeposit();
  const [selectedRows, setSelectedRows] = useState<SelectedRow[]>([]);

  const selected = useMemo(() => selectedRows.filter(row => row.selected && row.balance > 0n), [selectedRows]);

  const onDeposit = async () => {
    await startDeposit(selected.map(row => ({ chainKey: row.chainKey, amount: row.balance })));
  };

  return (
    <div className="space-y-6">
      <USDCBalanceScanner
        onSelectionChange={rows =>
          setSelectedRows(rows.map(row => ({ chainKey: row.chainKey, balance: row.balance, selected: row.selected })))
        }
      />

      <div className="card bg-base-100 shadow-xl">
        <div className="card-body">
          <h2 className="card-title">Gateway Deposit Flow</h2>
          <div className="space-y-2">
            {summary.map(row => (
              <div key={row.chainKey} className="flex items-center justify-between rounded-lg bg-base-200 px-4 py-2">
                <div className="font-semibold">{row.chainKey}</div>
                <div className="text-sm">{row.status}</div>
              </div>
            ))}
          </div>
          <button className="btn btn-primary mt-4" disabled={selected.length === 0} onClick={onDeposit}>
            Deposit to Gateway
          </button>
        </div>
      </div>

      <div className="card bg-base-100 shadow-xl">
        <div className="card-body">
          <h2 className="card-title">Unified Gateway Balance</h2>
          {gatewayBalance ? (
            <div className="space-y-2 text-sm">
              {gatewayBalance.balances.map(balance => (
                <div key={`${balance.chainId}-${balance.token}`} className="flex justify-between">
                  <span>Chain {balance.chainId}</span>
                  <span>{balance.balance}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm opacity-70">No unified balances yet.</div>
          )}
        </div>
      </div>
    </div>
  );
};
