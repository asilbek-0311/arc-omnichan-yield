"use client";

import { useState } from "react";
import type { NextPage } from "next";
import { DepositHistory } from "~~/components/DepositHistory";
import { DirectArcDeposit } from "~~/components/DirectArcDeposit";
import { OneClickZap } from "~~/components/OneClickZap";
import { ZapHistory } from "~~/components/ZapHistory";

const DepositPage: NextPage = () => {
  const [activeTab, setActiveTab] = useState<"zap" | "direct">("zap");

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Deposit to Arc Vault</h1>
        <p className="mt-2 text-xs opacity-70">
          Choose a deposit mode. Zap lets you deposit from any supported chain. Direct lets you deposit on Arc and mint
          yRWA without using the gateway.
        </p>
      </div>

      <div className="flex flex-wrap gap-3 mb-6">
        <button
          type="button"
          className={`btn btn-lg w-full sm:w-auto ${activeTab === "zap" ? "btn-primary" : "btn-outline"}`}
          onClick={() => setActiveTab("zap")}
        >
          Zap (Any chain)
        </button>
        <button
          type="button"
          className={`btn btn-lg w-full sm:w-auto ${activeTab === "direct" ? "btn-primary" : "btn-outline"}`}
          onClick={() => setActiveTab("direct")}
        >
          Direct on Arc
        </button>
      </div>

      {activeTab === "zap" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <OneClickZap />
          </div>
          <div>
            <ZapHistory />
          </div>
        </div>
      )}

      {activeTab === "direct" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <DirectArcDeposit />
          </div>
          <div>
            <DepositHistory />
          </div>
        </div>
      )}
    </div>
  );
};

export default DepositPage;
