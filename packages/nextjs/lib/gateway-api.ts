import { GATEWAY_CONFIG } from "~~/lib/gateway-config";

export type UnifiedBalanceResponse = {
  address: string;
  balances: {
    chainId: number;
    token: string;
    balance: string;
  }[];
};

export type BurnIntentPayload = {
  chainId: number;
  token: string;
  amount: string;
  recipient: string;
  domain: number;
  signature: string;
};

export type TransferResponse = {
  attestationId: string;
  status: "pending" | "complete";
};

async function gatewayFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${GATEWAY_CONFIG.apiUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gateway API error: ${res.status} ${text}`);
  }

  return (await res.json()) as T;
}

export async function checkUnifiedBalance(address: string) {
  return gatewayFetch<UnifiedBalanceResponse>(`/balances/${address}`);
}

export async function createBurnIntents(payload: Omit<BurnIntentPayload, "signature">) {
  return gatewayFetch<{ intent: string }>(`/burn-intents`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function submitTransfer(intents: BurnIntentPayload[]) {
  return gatewayFetch<TransferResponse>(`/transfer`, {
    method: "POST",
    body: JSON.stringify({ intents }),
  });
}
