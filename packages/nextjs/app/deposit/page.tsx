"use client";

import type { NextPage } from "next";
import { GatewayDeposit } from "~~/components/GatewayDeposit";

const DepositPage: NextPage = () => {
  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Deposit USDC</h1>
        <p className="mt-2 text-sm opacity-70">Select chains, approve USDC, and deposit via Circle Gateway.</p>
      </div>
      <GatewayDeposit />
    </div>
  );
};

export default DepositPage;
