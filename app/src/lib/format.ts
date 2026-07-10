/** Number/pubkey formatting helpers (USDC has 6 decimals). */
import { USDC_DECIMALS } from './constants';

export const usdcBase = (dollars: number): bigint =>
  BigInt(Math.round(dollars * 10 ** USDC_DECIMALS));

export const fromUsdc = (base: bigint | number): number =>
  Number(base) / 10 ** USDC_DECIMALS;

/** Format base units as a "$1,234.56" string. */
export function formatUsd(base: bigint | number): string {
  const n = fromUsdc(base);
  return n.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Short pubkey: "AbCd…WxYz". */
export function shortKey(key: string, lead = 4, tail = 4): string {
  if (key.length <= lead + tail + 1) return key;
  return `${key.slice(0, lead)}…${key.slice(-tail)}`;
}
