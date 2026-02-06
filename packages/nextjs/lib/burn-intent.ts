import type { Address, Hex } from "viem";
import type { WalletClient } from "viem";

export type BurnIntent = {
  from: Address;
  to: Address;
  token: Address;
  amount: bigint;
  domain: number;
  nonce: bigint;
};

export type SignedBurnIntent = BurnIntent & {
  signature: Hex;
};

export function createBurnIntent(params: Omit<BurnIntent, "nonce">): BurnIntent {
  return {
    ...params,
    nonce: BigInt(Date.now()),
  };
}

export async function signBurnIntent(intent: BurnIntent, walletClient: WalletClient) {
  const signature = await walletClient.signTypedData({
    account: intent.from,
    domain: {
      name: "CircleGateway",
      version: "1",
      chainId: Number(intent.domain),
    },
    primaryType: "BurnIntent",
    types: {
      BurnIntent: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "token", type: "address" },
        { name: "amount", type: "uint256" },
        { name: "domain", type: "uint32" },
        { name: "nonce", type: "uint256" },
      ],
    },
    message: intent,
  });

  return { ...intent, signature };
}

export function formatForAPI(intent: SignedBurnIntent) {
  return {
    from: intent.from,
    to: intent.to,
    token: intent.token,
    amount: intent.amount.toString(),
    domain: intent.domain,
    nonce: intent.nonce.toString(),
    signature: intent.signature,
  };
}
