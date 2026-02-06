import { useEffect, useState } from "react";
import { type UnifiedBalanceResponse, checkUnifiedBalance } from "~~/lib/gateway-api";

export const useGatewayBalance = (address?: string) => {
  const [data, setData] = useState<UnifiedBalanceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let timeoutId: NodeJS.Timeout | null = null;
    let isMounted = true;
    let pollCount = 0;
    const maxPolls = 20; // Stop after ~10 minutes

    // Exponential backoff: fast at first, then slower
    const getInterval = (count: number) => {
      if (count < 10) return 3_000; // 0-30s: check every 3s (fast detection)
      if (count < 20) return 10_000; // 30s-2min: check every 10s
      return 30_000; // 2min+: check every 30s
    };

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

    const schedulePoll = () => {
      if (!isMounted || pollCount >= maxPolls) {
        return;
      }

      const interval = getInterval(pollCount);
      timeoutId = setTimeout(() => {
        fetchBalances().then(() => {
          pollCount++;
          schedulePoll();
        });
      }, interval);
    };

    // Initial fetch
    fetchBalances().then(() => {
      pollCount++;
      schedulePoll();
    });

    return () => {
      isMounted = false;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [address]);

  return { data, error, isLoading };
};
