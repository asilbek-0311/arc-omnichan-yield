"use client";

import type { NextPage } from "next";
import { OneClickZap } from "~~/components/OneClickZap";
import { ZapHistory } from "~~/components/ZapHistory";

const DepositPage: NextPage = () => {
  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Deposit to Arc Vault</h1>
        <p className="mt-2 text-sm opacity-70">
          One-click deposit: Your USDC will be automatically bridged to Arc and deposited into the vault.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <OneClickZap />
        </div>
        <div>
          <ZapHistory />
        </div>
      </div>
    </div>
  );
};

export default DepositPage;
