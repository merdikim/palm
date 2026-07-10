/**
 * SwapProvider — the swap leg of agent_pay, behind an interface with
 * atomic-failure semantics (docs/spikes.md S5).
 *
 * On devnet there is no DEX liquidity, so the default provider is a
 * deterministic MOCK: a fixed reference rate + a configurable slippage, so that
 * quote/slippage-bound behavior (and atomic failure when slippage exceeds the
 * vault bound) is fully exercised. A mainnet build swaps this for a provider
 * backed by the hosted `/v1/swap` endpoint — the interface is unchanged.
 */
import { USDC_DEVNET } from "./constants.js";

export interface SwapQuoteResult {
  /** USDC base units that must leave the vault to deliver `amountOut`. */
  usdcDebit: bigint;
  /** Quoted slippage vs. the reference price, in basis points. */
  quotedSlippageBps: number;
  /** True if this is a real (non-mock) route. */
  live: boolean;
}

export interface SwapProvider {
  /** Quote the USDC needed to deliver `amountOut` of `mintOut`. */
  quote(mintOut: string, amountOut: bigint, opts?: { forceSlippageBps?: number }): Promise<SwapQuoteResult>;
}

/**
 * Deterministic mock. Direct USDC = 1:1, zero slippage. Any other mint uses a
 * fixed reference rate table; unknown mints get a default rate. `forceSlippageBps`
 * lets tests drive the slippage above/below a vault's bound to prove the atomic
 * failure path.
 */
export class MockSwapProvider implements SwapProvider {
  /** reference USDC-per-1-unit-out (base units in / base unit out). */
  private rates: Record<string, number>;
  constructor(rates?: Record<string, number>) {
    // Default: 1 unit of "mintOut" costs 2 USDC (base-unit ratio), arbitrary.
    this.rates = rates ?? {};
  }
  async quote(mintOut: string, amountOut: bigint, opts?: { forceSlippageBps?: number }): Promise<SwapQuoteResult> {
    if (mintOut === USDC_DEVNET || mintOut === "USDC") {
      return { usdcDebit: amountOut, quotedSlippageBps: opts?.forceSlippageBps ?? 0, live: false };
    }
    const rate = this.rates[mintOut] ?? 2; // 2 USDC per out-unit by default
    const usdcDebit = BigInt(Math.ceil(Number(amountOut) * rate));
    return { usdcDebit, quotedSlippageBps: opts?.forceSlippageBps ?? 30, live: false };
  }
}

/** Factory: devnet → mock. (Mainnet would return a hosted-API-backed provider.) */
export function defaultSwapProvider(): SwapProvider {
  return new MockSwapProvider();
}
