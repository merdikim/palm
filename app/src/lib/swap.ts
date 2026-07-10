/**
 * SwapProvider — the swap leg of agent_pay behind an interface (build spec D5).
 *
 * Devnet has no DEX route (spikes S5), so the default provider is a deterministic
 * mock that preserves atomic-failure semantics: a quote whose slippage exceeds
 * the caller's bound is rejected, so the whole payment fails rather than moving
 * funds at a bad price. A mainnet build swaps this for the live `/v1/swap` flow
 * without changing call sites.
 */
import { USDC_DEVNET } from './constants';
import type { Quote } from './vault';

export interface SwapQuoteRequest {
  inputMint: string; // always USDC for our vault debits
  outputMint: string;
  amountOut: bigint; // desired output amount (base units of outputMint)
  maxSlippageBps: number;
}

export interface SwapProvider {
  /** Return the USDC debit + quoted slippage for delivering `amountOut`. */
  quote(req: SwapQuoteRequest): Promise<Quote>;
}

/**
 * Deterministic mock. USDC->USDC is a pure pass-through (debit == amountOut,
 * slippage 0). For any other output mint, applies a fixed 1:1 reference rate
 * plus a fixed spread, and reports a slippage the caller's bound must accept.
 */
export class MockSwapProvider implements SwapProvider {
  constructor(
    private readonly spreadBps = 30, // fixed 0.3% mock spread
    private readonly rate = 1, // 1 USDC : 1 outputMint (devnet fiction)
  ) {}

  async quote(req: SwapQuoteRequest): Promise<Quote> {
    if (req.outputMint === USDC_DEVNET || req.inputMint === req.outputMint) {
      return { usdcDebit: req.amountOut, quotedSlippageBps: 0 };
    }
    // usdcDebit = amountOut / rate, inflated by the spread.
    const raw = Number(req.amountOut) / this.rate;
    const withSpread = Math.ceil(raw * (1 + this.spreadBps / 10_000));
    return {
      usdcDebit: BigInt(withSpread),
      quotedSlippageBps: this.spreadBps,
    };
  }
}

/** Direct USDC payment quote (no swap): debit == amountOut. */
export function directQuote(amountOut: bigint): Quote {
  return { usdcDebit: amountOut, quotedSlippageBps: 0 };
}

export const defaultSwapProvider: SwapProvider = new MockSwapProvider();
