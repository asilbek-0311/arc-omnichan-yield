"use client";

import type { ZapState } from "~~/hooks/useZapDeposit";
import { getBlockExplorerTxLink } from "~~/utils/scaffold-eth";

type Step = {
  key: string;
  label: string;
  icon: string;
  statuses: string[];
};

const STEPS: Step[] = [
  {
    key: "switch",
    label: "Switch to source chain",
    icon: "🔄",
    statuses: ["switching"],
  },
  {
    key: "swap",
    label: "Swap to USDC (if needed)",
    icon: "🔁",
    statuses: ["approving_swap", "swapping"],
  },
  {
    key: "gateway",
    label: "Deposit to Circle Gateway",
    icon: "🌉",
    statuses: ["approving_gateway", "depositing_gateway"],
  },
  {
    key: "bridge",
    label: "Bridging to Arc",
    icon: "⏳",
    statuses: ["bridging"],
  },
  {
    key: "claim",
    label: "Ready to claim on Arc",
    icon: "👆",
    statuses: ["awaiting_claim"],
  },
  {
    key: "vault",
    label: "Depositing to vault",
    icon: "🏦",
    statuses: ["claiming", "depositing_vault"],
  },
  {
    key: "done",
    label: "Complete!",
    icon: "✅",
    statuses: ["completed"],
  },
];

type Props = {
  state: ZapState;
};

export const ZapProgress = ({ state }: Props) => {
  const getStepStatus = (step: Step): "pending" | "active" | "completed" => {
    if (state.status === "completed") {
      return "completed";
    }

    if (step.statuses.includes(state.status)) {
      return "active";
    }

    const currentStepIndex = STEPS.findIndex(s => s.statuses.includes(state.status));
    const stepIndex = STEPS.indexOf(step);

    if (stepIndex < currentStepIndex) {
      return "completed";
    }

    return "pending";
  };

  return (
    <div className="space-y-4">
      {/* Overall Progress Bar */}
      <div>
        <div className="flex justify-between mb-2">
          <span className="text-sm font-semibold">{state.status === "failed" ? "❌ Failed" : state.currentStep}</span>
          <span className="text-sm text-base-content/70">{state.progress}%</span>
        </div>
        <progress
          className={`progress ${state.status === "failed" ? "progress-error" : "progress-primary"} w-full`}
          value={state.progress}
          max="100"
        ></progress>
      </div>

      {/* Step-by-Step Progress */}
      <div className="space-y-2">
        {STEPS.map(step => {
          const status = getStepStatus(step);

          return (
            <div
              key={step.key}
              className={`flex items-center gap-3 p-2 rounded-lg transition-all ${
                status === "active"
                  ? "bg-primary/10 border border-primary"
                  : status === "completed"
                    ? "bg-success/10"
                    : "bg-base-200/50"
              }`}
            >
              <span className="text-2xl">{status === "completed" ? "✅" : step.icon}</span>
              <span
                className={`flex-1 ${
                  status === "active"
                    ? "font-semibold"
                    : status === "completed"
                      ? "text-base-content/70"
                      : "text-base-content/50"
                }`}
              >
                {step.label}
              </span>
              {status === "active" && <span className="loading loading-spinner loading-sm"></span>}
            </div>
          );
        })}
      </div>

      {/* Transaction Link */}
      {state.txHash && state.txChainId && (
        <div className="alert alert-info">
          <div className="flex flex-col gap-1">
            <span className="font-semibold">Transaction Submitted</span>
            <a
              href={getBlockExplorerTxLink(state.txChainId, state.txHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="link link-primary text-sm"
            >
              View on Explorer →
            </a>
          </div>
        </div>
      )}

      {/* Error Display */}
      {state.error && (
        <div className="alert alert-error">
          <div className="flex flex-col gap-1">
            <span className="font-semibold">Error</span>
            <span className="text-sm">{state.error}</span>
          </div>
        </div>
      )}

      {/* Success Message */}
      {state.status === "completed" && (
        <div className="alert alert-success">
          <div className="flex flex-col gap-1">
            <span className="font-semibold">Zap Completed Successfully!</span>
            <span className="text-sm">
              Your yRWA tokens should appear in your wallet shortly. Switch to Arc network to view your vault balance.
            </span>
          </div>
        </div>
      )}

      {/* Bridging Info */}
      {state.status === "bridging" && (
        <div className="alert">
          <div className="flex flex-col gap-1">
            <span className="font-semibold">⏳ Bridging in Progress</span>
            <span className="text-sm">
              Circle Gateway is bridging your USDC to Arc. This typically takes 5-10 minutes. You can safely close this
              page - the ZapReceiver will automatically complete the vault deposit when your USDC arrives on Arc.
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
