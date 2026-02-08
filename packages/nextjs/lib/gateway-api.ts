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
  maxBlockHeight: string;
  maxFee: string;
  feeToken: string;
  sourceDomain: number;
  destinationDomain: number;
  spec: {
    version: string;
    sourceDomain: number;
    destinationDomain: number;
    sourceContract: string;
    destinationContract: string;
    sourceToken: string;
    destinationToken: string;
    sourceDepositor: string;
    destinationRecipient: string;
    sourceSigner: string;
    destinationCaller: string;
    value: string;
    salt: string;
    hookData: string;
  };
};

export type TransferIntent = {
  burnIntent: BurnIntentPayload;
  signature: string;
};

export type TransferResponse = {
  attestation: string;
  signature: string;
  transferId: string;
  expirationBlock?: string;
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

export async function submitTransfer(intents: TransferIntent[]) {
  return gatewayFetch<TransferResponse>(`/transfer`, {
    method: "POST",
    body: JSON.stringify(intents),
  });
}
