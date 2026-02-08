/**
 * Vault Helper Utilities
 *
 * Utility functions for RWAVault share price calculations and formatting.
 *
 * **Important: WAD Format**
 * - The vault uses WAD format (1e18 precision) for share price
 * - yRWA token has 6 decimals (matches USDC)
 * - This mismatch requires careful conversion
 *
 * **Why WAD?**
 * - Prevents rounding errors in fee calculations (20% treasury fee)
 * - Enables precise share price tracking as yield is deposited
 * - Formula: sharePrice = (totalAssets * 1e18) / totalSupply
 *
 * **Example:**
 * - 1.0 USDC per yRWA = 1000000000000000000n (WAD)
 * - 1.05 USDC per yRWA = 1050000000000000000n (WAD)
 *
 * @module vault-helpers
 */
import { formatUnits } from "viem";

/**
 * Converts share price from WAD format (1e18) to human-readable format
 *
 * @param sharePrice - Share price in WAD format (1e18 precision)
 * @returns Formatted share price as string with 6 decimals (e.g., "1.050000")
 *
 * @example
 * ```ts
 * const price = 1050000000000000000n; // 1.05 in WAD
 * formatSharePrice(price); // "1.050000"
 * ```
 */
export const formatSharePrice = (sharePrice: bigint | undefined): string => {
  if (!sharePrice) return "1.000000";
  return Number(formatUnits(sharePrice, 18)).toFixed(6);
};

/**
 * Calculates USDC value of yRWA tokens based on current share price
 *
 * @param yRwaBalance - yRWA token balance (6 decimals)
 * @param sharePrice - Share price in WAD format (1e18 precision)
 * @returns USDC value (6 decimals)
 *
 * @remarks
 * Formula: usdcValue = (yRwaBalance * sharePrice) / 1e18
 * The division by 1e18 converts from WAD back to 6 decimals
 *
 * @example
 * ```ts
 * const balance = 1000000n; // 1 yRWA (6 decimals)
 * const price = 1050000000000000000n; // 1.05 in WAD
 * calculateUSDCValue(balance, price); // 1050000n (1.05 USDC)
 * ```
 */
export const calculateUSDCValue = (yRwaBalance: bigint, sharePrice: bigint): bigint => {
  return (yRwaBalance * sharePrice) / 1_000_000_000_000_000_000n;
};

/**
 * Formats USDC value for user-friendly display
 *
 * @param value - USDC value (6 decimals)
 * @returns Formatted string with 2 decimal places (e.g., "1,234.56")
 *
 * @example
 * ```ts
 * formatUSDCValue(1234560000n); // "1234.56"
 * formatUSDCValue(undefined); // "0.00"
 * ```
 */
export const formatUSDCValue = (value: bigint | undefined): string => {
  if (!value) return "0.00";
  return Number(formatUnits(value, 6)).toFixed(2);
};

/**
 * Formats yRWA balance for precise display
 *
 * @param balance - yRWA balance (6 decimals)
 * @returns Formatted string with 6 decimal places (e.g., "1.500000")
 *
 * @remarks
 * Uses 6 decimals to match USDC precision
 *
 * @example
 * ```ts
 * formatYRWABalance(1500000n); // "1.500000"
 * formatYRWABalance(undefined); // "0.000000"
 * ```
 */
export const formatYRWABalance = (balance: bigint | undefined): string => {
  if (!balance) return "0.000000";
  return Number(formatUnits(balance, 6)).toFixed(6);
};

/**
 * Calculates maximum yRWA withdrawable based on vault USDC liquidity
 *
 * @param totalUSDC - Total USDC available in vault (6 decimals)
 * @param sharePrice - Share price in WAD format (1e18 precision)
 * @returns Maximum yRWA that can be withdrawn (6 decimals)
 *
 * @remarks
 * Withdrawals are limited by actual USDC balance, not claimed RWA value.
 * Formula: maxShares = (totalUSDC * 1e18) / sharePrice
 *
 * **Why this matters:**
 * - Vault tracks off-chain RWA value (illiquid)
 * - Only USDC is withdrawable
 * - User may have more yRWA value than can be withdrawn
 *
 * @example
 * ```ts
 * const usdc = 5000000n; // 5 USDC available
 * const price = 1000000000000000000n; // 1.0
 * calculateMaxWithdrawable(usdc, price); // 5000000n (5 yRWA max)
 * ```
 */
export const calculateMaxWithdrawable = (totalUSDC: bigint, sharePrice: bigint): bigint => {
  if (sharePrice === 0n) return 0n;
  return (totalUSDC * 1_000_000_000_000_000_000n) / sharePrice;
};

/**
 * Validates if withdrawal amount is within available vault liquidity
 *
 * @param withdrawAmount - Amount of yRWA user wants to withdraw (6 decimals)
 * @param maxWithdrawable - Maximum yRWA withdrawable based on USDC balance (6 decimals)
 * @returns True if withdrawal is valid, false otherwise
 *
 * @remarks
 * Checks:
 * - Amount > 0 (prevents zero withdrawals)
 * - Amount <= maxWithdrawable (prevents liquidity errors)
 *
 * @example
 * ```ts
 * isWithdrawalValid(2000000n, 5000000n); // true (2 <= 5)
 * isWithdrawalValid(10000000n, 5000000n); // false (10 > 5)
 * isWithdrawalValid(0n, 5000000n); // false (zero amount)
 * ```
 */
export const isWithdrawalValid = (withdrawAmount: bigint, maxWithdrawable: bigint): boolean => {
  return withdrawAmount > 0n && withdrawAmount <= maxWithdrawable;
};

/**
 * Calculates yRWA shares received for a USDC deposit
 *
 * @param usdcAmount - USDC deposit amount (6 decimals)
 * @param sharePrice - Share price in WAD format (1e18 precision)
 * @returns yRWA shares to be minted (6 decimals)
 *
 * @remarks
 * Formula: shares = (usdcAmount * 1e18) / sharePrice
 * Initial deposits (sharePrice = 1e18) mint 1:1
 *
 * **Example scenarios:**
 * - Deposit 10 USDC at price 1.0 → receive 10 yRWA
 * - Deposit 10 USDC at price 1.05 → receive 9.52 yRWA
 * - Deposit 10 USDC at price 0.95 → receive 10.53 yRWA
 *
 * @example
 * ```ts
 * const usdc = 10000000n; // 10 USDC
 * const price = 1050000000000000000n; // 1.05
 * calculateSharesFromDeposit(usdc, price); // 9523809n (9.52 yRWA)
 * ```
 */
export const calculateSharesFromDeposit = (usdcAmount: bigint, sharePrice: bigint): bigint => {
  if (sharePrice === 0n) return usdcAmount;
  return (usdcAmount * 1_000_000_000_000_000_000n) / sharePrice;
};
