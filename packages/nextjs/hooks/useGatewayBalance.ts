import { useEffect, useState } from "react";
import { type UnifiedBalanceResponse, checkUnifiedBalance } from "~~/lib/gateway-api";

export const useGatewayBalance = (address?: string) => {
  const [data, setData] = useState<UnifiedBalanceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let intervalId: NodeJS.Timeout | null = null;
    let isMounted = true;

    const fetchBalances = async () => {
      if (!address) {
        setData(null);
        return;
      }
      setIsLoading(true);
      try {
        const res = await checkUnifiedBalance(address);
        if (isMounted) {
          setData(res);
          setError(null);
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : "Failed to load Gateway balances");
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    fetchBalances();
    intervalId = setInterval(fetchBalances, 30_000);

    return () => {
      isMounted = false;
      if (intervalId) clearInterval(intervalId);
    };
  }, [address]);

  return { data, error, isLoading };
};
