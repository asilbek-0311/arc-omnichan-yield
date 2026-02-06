"use client";

import Link from "next/link";
import type { NextPage } from "next";
import { useAccount } from "wagmi";
import { useTargetNetwork } from "~~/hooks/scaffold-eth";

const Home: NextPage = () => {
  const { address: connectedAddress } = useAccount();
  const { targetNetwork } = useTargetNetwork();

  return (
    <>
      <div className="flex items-center flex-col grow">
        <div className="hero min-h-[70vh] bg-base-200">
          <div className="hero-content text-center">
            <div className="max-w-3xl">
              <h1 className="text-4xl font-bold md:text-6xl">Omni-Yield</h1>
              <p className="py-4 text-lg opacity-80">
                Earn RWA-backed yield on USDC across chains. Deposit once, mint yRWA on Arc Testnet, and let your
                capital work.
              </p>
              <div className="flex flex-wrap justify-center gap-3">
                <Link href="/deposit" className="btn btn-primary">
                  Deposit USDC
                </Link>
                <Link href="/vault" className="btn btn-outline">
                  View Vault
                </Link>
              </div>
              <div className="mt-4 text-sm opacity-70">
                Connected: {connectedAddress ? `${connectedAddress.slice(0, 6)}...${connectedAddress.slice(-4)}` : "—"}
              </div>
              <div className="mt-2 text-sm opacity-70">Network: {targetNetwork.name}</div>
            </div>
          </div>
        </div>

        <div className="w-full bg-base-300 px-8 py-12">
          <div className="mx-auto grid max-w-5xl gap-6 md:grid-cols-3">
            <div className="rounded-3xl bg-base-100 p-6 shadow-xl">
              <h3 className="text-lg font-semibold">Multi-chain deposits</h3>
              <p className="mt-2 text-sm opacity-70">
                Use Circle Gateway to move USDC from multiple testnets in one flow.
              </p>
            </div>
            <div className="rounded-3xl bg-base-100 p-6 shadow-xl">
              <h3 className="text-lg font-semibold">RWA-backed yield</h3>
              <p className="mt-2 text-sm opacity-70">Track share price growth as off-chain yield is deposited.</p>
            </div>
            <div className="rounded-3xl bg-base-100 p-6 shadow-xl">
              <h3 className="text-lg font-semibold">Transparent vault</h3>
              <p className="mt-2 text-sm opacity-70">Monitor TVL, share price, and admin activity on-chain.</p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default Home;
