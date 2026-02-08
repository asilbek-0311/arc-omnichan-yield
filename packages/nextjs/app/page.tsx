"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { NextPage } from "next";
import { useAccount } from "wagmi";
import { useTargetNetwork } from "~~/hooks/scaffold-eth";

const Home: NextPage = () => {
  const { address: connectedAddress } = useAccount();
  const { targetNetwork } = useTargetNetwork();
  const [isRedirecting, setIsRedirecting] = useState(true);

  // useEffect(() => {
  //   const timeout = setTimeout(() => {
  //     router.push("/deposit");
  //   }, 1000);

  //   return () => clearTimeout(timeout);
  // }, [router]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setIsRedirecting(false);
    }, 1200);

    return () => clearTimeout(timeout);
  }, []);

  return (
    <>
      <div className="flex items-center flex-col grow">
        <section className="relative w-full">
          <div className="mx-auto max-w-6xl px-6 pb-16 pt-14 lg:pt-20">
            <div className="grid items-center gap-8 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="glass-panel relative overflow-hidden p-8">
                <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-primary/80">
                  <span className="h-2 w-2 rounded-full bg-primary shadow-[0_0_12px_rgba(77,163,255,0.9)]" />
                  Arc Testnet
                </div>
                <h1 className="mt-4 text-4xl font-semibold md:text-6xl">Omni-Yield</h1>
                <p className="mt-4 text-base opacity-80">
                  Earn RWA-backed yield on USDC across chains. Deposit once, mint yRWA on Arc Testnet, and let your
                  capital work.
                </p>
                {isRedirecting && (
                  <div className="mt-3 text-xs uppercase tracking-[0.2em] text-primary/70">
                    Redirecting to Deposit...
                  </div>
                )}
                <div className="mt-6 flex flex-wrap gap-3">
                  <Link href="/deposit" className="btn btn-primary">
                    Deposit USDC
                  </Link>
                  <Link href="/vault" className="btn btn-outline">
                    View Vault
                  </Link>
                </div>
                <div className="mt-6 flex flex-wrap gap-6 text-xs uppercase tracking-[0.2em] text-base-content/60">
                  <span>
                    Connected:{" "}
                    {connectedAddress ? `${connectedAddress.slice(0, 6)}...${connectedAddress.slice(-4)}` : "—"}
                  </span>
                  <span>Network: {targetNetwork.name}</span>
                </div>
              </div>

              <div className="glass-panel p-6">
                <div className="flex flex-col gap-5">
                  <div className="flex items-start gap-3">
                    <div className="badge badge-outline border-primary/50 text-primary">01</div>
                    <div>
                      <h3 className="text-sm font-semibold uppercase tracking-[0.2em]">Deposit</h3>
                      <p className="mt-2 text-sm opacity-70">
                        Use Circle Gateway to move USDC from multiple testnets in one flow.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="badge badge-outline border-primary/50 text-primary">02</div>
                    <div>
                      <h3 className="text-sm font-semibold uppercase tracking-[0.2em]">Mint yRWA</h3>
                      <p className="mt-2 text-sm opacity-70">
                        Receive yield-bearing shares on Arc as real-world yield is deposited.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="badge badge-outline border-primary/50 text-primary">03</div>
                    <div>
                      <h3 className="text-sm font-semibold uppercase tracking-[0.2em]">Track Yield</h3>
                      <p className="mt-2 text-sm opacity-70">
                        Monitor share price growth, TVL, and vault activity in real time.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="w-full pb-16">
          <div className="mx-auto grid max-w-6xl gap-6 px-6 md:grid-cols-3">
            <div className="glass-panel p-6">
              <div className="text-xs uppercase tracking-[0.2em] text-primary/70">Cross-chain</div>
              <h3 className="mt-3 text-lg font-semibold">Multi-chain deposits</h3>
              <p className="mt-2 text-sm opacity-70">
                Aggregate liquidity from supported testnets in a single deposit flow.
              </p>
            </div>
            <div className="glass-panel p-6">
              <div className="text-xs uppercase tracking-[0.2em] text-primary/70">Real Yield</div>
              <h3 className="mt-3 text-lg font-semibold">RWA-backed yield</h3>
              <p className="mt-2 text-sm opacity-70">Track share price growth as off-chain yield is deposited.</p>
            </div>
            <div className="glass-panel p-6">
              <div className="text-xs uppercase tracking-[0.2em] text-primary/70">Transparency</div>
              <h3 className="mt-3 text-lg font-semibold">On-chain vault</h3>
              <p className="mt-2 text-sm opacity-70">Monitor TVL, share price, and admin activity on-chain.</p>
            </div>
          </div>
        </section>
      </div>
    </>
  );
};

export default Home;
