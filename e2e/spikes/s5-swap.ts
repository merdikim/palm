/**
 * S5 — Swap availability on devnet.
 *
 * Probes /v1/swap/quote for several mint pairs to learn whether devnet TEE
 * swaps are live and which pairs have liquidity. The result decides whether
 * agent_pay's swap leg runs live or behind the deterministic mock (with the
 * same atomic-failure semantics either way).
 */
import { readFileSync } from "node:fs";
import { section } from "../../shared/solana.ts";
import { swapQuote } from "../../shared/payments.ts";
import { USDC_DEVNET } from "../../shared/constants.ts";

const deploy = JSON.parse(readFileSync(new URL("../../shared/deployment.json", import.meta.url), "utf8"));
const SOL = "So11111111111111111111111111111111111111112";

const pairs: [string, string, string, string][] = [
  ["USDC->SOL", USDC_DEVNET, SOL, "1000000"],
  ["SOL->USDC", SOL, USDC_DEVNET, "100000000"],
  ["testMint->USDC", deploy.testMint, USDC_DEVNET, "1000000"],
];

async function main() {
  section("S5 — swap quote probes (devnet)");
  let anyLive = false;
  for (const [label, inputMint, outputMint, amount] of pairs) {
    try {
      const q = await swapQuote({ inputMint, outputMint, amount, slippageBps: 100 });
      const out = (q as any).outAmount ?? "?";
      console.log(`  ${label.padEnd(16)} OK  outAmount=${out} impact=${(q as any).priceImpactPct ?? "?"}`);
      anyLive = true;
    } catch (e) {
      console.log(`  ${label.padEnd(16)} no route: ${(e as Error).message.slice(0, 90)}`);
    }
  }
  console.log(
    anyLive
      ? "\nS5: at least one devnet swap route is live → swap leg can run live for those pairs."
      : "\nS5: no devnet swap routes → agent_pay swap leg uses the deterministic mock (atomic-failure semantics preserved).",
  );
}
main().catch((e) => { console.error("S5 error", e); process.exit(1); });
