import { formatUnits } from "viem";

/**
 * Converts share price from WAD format (1e18) to a user-friendly number
 * @param sharePrice - Share price in WAD format (1e18 precision)
 * @returns Formatted share price as a string with 6 decimals
 */
export const formatSharePrice = (sharePrice: bigint | undefined): string => {
  if (!sharePrice) return "1.000000";
  return Number(formatUnits(sharePrice, 18)).toFixed(6);
};

/**
 * Calculates the USDC value of yRWA tokens based on share price
 * @param yRwaBalance - yRWA token balance (6 decimals)
 * @param sharePrice - Share price in WAD format (1e18 precision)
 * @returns USDC value with 6 decimals precision
 */
export const calculateUSDCValue = (yRwaBalance: bigint, sharePrice: bigint): bigint => {
  return (yRwaBalance * sharePrice) / 1_000_000_000_000_000_000n;
};

/**
 * Formats USDC value for display
 * @param value - USDC value in 6 decimals
 * @returns Formatted string with 2 decimal places
 */
export const formatUSDCValue = (value: bigint | undefined): string => {
  if (!value) return "0.00";
  return Number(formatUnits(value, 6)).toFixed(2);
};

/**
 * Formats yRWA balance for display
 * @param balance - yRWA balance in 6 decimals
 * @returns Formatted string with 6 decimal places
 */
export const formatYRWABalance = (balance: bigint | undefined): string => {
  if (!balance) return "0.000000";
  return Number(formatUnits(balance, 6)).toFixed(6);
};

/**
 * Calculates maximum withdrawable yRWA based on available USDC and share price
 * @param totalUSDC - Total USDC available in vault (6 decimals)
 * @param sharePrice - Share price in WAD format (1e18 precision)
 * @returns Maximum yRWA that can be withdrawn (6 decimals)
 */
export const calculateMaxWithdrawable = (totalUSDC: bigint, sharePrice: bigint): bigint => {
  if (sharePrice === 0n) return 0n;
  return (totalUSDC * 1_000_000_000_000_000_000n) / sharePrice;
};

/**
 * Validates if withdrawal amount is within available liquidity
 * @param withdrawAmount - Amount of yRWA user wants to withdraw (6 decimals)
 * @param maxWithdrawable - Maximum yRWA that can be withdrawn (6 decimals)
 * @returns true if withdrawal is valid, false otherwise
 */
export const isWithdrawalValid = (withdrawAmount: bigint, maxWithdrawable: bigint): boolean => {
  return withdrawAmount > 0n && withdrawAmount <= maxWithdrawable;
};

/**
 * Calculates the number of yRWA shares received for a USDC deposit
 * @param usdcAmount - USDC deposit amount (6 decimals)
 * @param sharePrice - Share price in WAD format (1e18 precision)
 * @returns yRWA shares to be minted (6 decimals)
 */
export const calculateSharesFromDeposit = (usdcAmount: bigint, sharePrice: bigint): bigint => {
  if (sharePrice === 0n) return usdcAmount;
  return (usdcAmount * 1_000_000_000_000_000_000n) / sharePrice;
};
