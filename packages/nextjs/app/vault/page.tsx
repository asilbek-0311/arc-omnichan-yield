"use client";

import type { NextPage } from "next";
import { VaultDashboard } from "~~/components/VaultDashboard";

const VaultPage: NextPage = () => {
  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Vault</h1>
        <p className="mt-2 text-sm opacity-70">Manage your yRWA position and withdraw USDC.</p>
      </div>
      <VaultDashboard />
    </div>
  );
};

export default VaultPage;
