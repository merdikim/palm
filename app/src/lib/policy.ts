/**
 * Tiered vault policy presets, keyed by funding amount (build spec D6).
 *   < $50   : Tier 1 — per-tx cap + slippage bound only.
 *   < $500  : Tier 1 + a rolling daily limit.
 *   >= $500 : suggest an allowlist + an over-threshold approval requirement.
 */
import { PublicKey } from '@solana/web3.js';
import { usdcBase } from './format';
import type { Policy } from './vault';

export type Tier = 1 | 2 | 3;

export function tierForFunding(dollars: number): Tier {
  if (dollars < 50) return 1;
  if (dollars < 500) return 2;
  return 3;
}

export interface PresetOptions {
  fundingDollars: number;
  /** Optional allowlist for tier 3 (merchant pubkeys). */
  allowlist?: PublicKey[];
  expiryUnix?: bigint | null;
}

/** Suggested default policy for a funding amount. Editable before submit. */
export function presetPolicy(opts: PresetOptions): Policy {
  const tier = tierForFunding(opts.fundingDollars);
  const perTx = usdcBase(Math.max(5, Math.min(opts.fundingDollars * 0.2, 100)));

  const base: Policy = {
    maxPerTx: perTx,
    maxSlippageBps: 100, // 1%
    dailyLimit: null,
    merchantAllowlist: null,
    approvalThreshold: null,
    expiry: opts.expiryUnix ?? null,
  };

  if (tier >= 2) {
    base.dailyLimit = usdcBase(Math.max(20, opts.fundingDollars * 0.5));
  }
  if (tier >= 3) {
    base.merchantAllowlist = opts.allowlist ?? null;
    base.approvalThreshold = usdcBase(Math.max(50, opts.fundingDollars * 0.25));
  }
  return base;
}

export function tierSummary(tier: Tier): string {
  switch (tier) {
    case 1:
      return 'Tier 1 — per-tx cap + slippage bound';
    case 2:
      return 'Tier 2 — + rolling daily limit';
    case 3:
      return 'Tier 3 — + allowlist + approval threshold';
  }
}

/** Human-readable summary of a policy for the agents list. */
export function policySummary(p: Policy): string {
  const parts: string[] = [];
  parts.push(`≤ $${Number(p.maxPerTx) / 1e6}/tx`);
  parts.push(`${p.maxSlippageBps / 100}% slip`);
  if (p.dailyLimit != null) parts.push(`$${Number(p.dailyLimit) / 1e6}/day`);
  if (p.approvalThreshold != null)
    parts.push(`approval > $${Number(p.approvalThreshold) / 1e6}`);
  if (p.merchantAllowlist)
    parts.push(`allowlist(${p.merchantAllowlist.length})`);
  if (p.expiry != null) parts.push('expiring');
  return parts.join(' · ');
}
