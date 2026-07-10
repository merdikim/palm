/**
 * E2E-3: Agent pays a merchant that wants a DIFFERENT mint → swap path (mock per
 * spikes S5) → the USDC debit is computed from the quote and all caps apply on
 * the USDC side → atomic failure when quoted slippage exceeds the vault bound.
 *
 * On devnet there is no DEX (spikes S5), so the on-chain move is the USDC debit
 * to the merchant and the swap is modelled by the MockSwapProvider. The point
 * proven here: the vault enforces the slippage bound atomically — a quote over
 * the bound reverts the whole payment.
 *
 *   npm run e2e:3
 */
import { Keypair, PublicKey } from "@solana/web3.js";
import { head, ok, conn, actors, ata, balance, fundFromAlice, usd, TEST_MINT } from "./_shared.ts";
import { makeProgram, vaultPda, vaultAta, createVaultIx, agentPayIx, type Policy } from "../../shared/vault.ts";
import { MockSwapProvider } from "../../shared/swap.ts";

// A pretend "merchant wants EURC" mint (no devnet liquidity — mock quotes it).
const MINT_OUT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

async function main() {
  const { payer, alice, merchant } = actors;
  const program = makeProgram(conn, payer);
  const agent = Keypair.generate();
  const swap = new MockSwapProvider({ [MINT_OUT.toBase58()]: 2 }); // 2 USDC per out-unit

  head("Vault with max_slippage_bps = 50 (0.5%), funded $100");
  const policy: Policy = { maxPerTx: usd(100), maxSlippageBps: 50, dailyLimit: null, merchantAllowlist: null, approvalThreshold: null, expiry: null };
  await createVaultIx(program, alice.publicKey, agent.publicKey, TEST_MINT, policy).signers([alice]).rpc();
  const [vault] = vaultPda(alice.publicKey, agent.publicKey);
  await fundFromAlice(vaultAta(vault, TEST_MINT), usd(100));
  const merchantAta = await ata(merchant.publicKey);

  head("Merchant wants 5 units of MINT_OUT — quote within slippage bound → executes");
  const goodQuote = await swap.quote(MINT_OUT.toBase58(), 5_000_000n, { forceSlippageBps: 40 }); // 40 <= 50
  const mBefore = await balance(merchant.publicKey);
  await agentPayIx(program, alice.publicKey, agent.publicKey, TEST_MINT, merchantAta, MINT_OUT, 5_000_000n, { usdcDebit: goodQuote.usdcDebit, quotedSlippageBps: goodQuote.quotedSlippageBps }).signers([agent]).rpc();
  ok(await balance(merchant.publicKey) - mBefore === goodQuote.usdcDebit, `swap-then-send debited $${Number(goodQuote.usdcDebit)/1e6} USDC (mock delivery)`);

  head("Same payment but quote slippage 60bps > 50bps bound → atomic failure, nothing moves");
  const badQuote = await swap.quote(MINT_OUT.toBase58(), 5_000_000n, { forceSlippageBps: 60 });
  const mBefore2 = await balance(merchant.publicKey);
  let reverted = false;
  try {
    await agentPayIx(program, alice.publicKey, agent.publicKey, TEST_MINT, merchantAta, MINT_OUT, 5_000_000n, { usdcDebit: badQuote.usdcDebit, quotedSlippageBps: badQuote.quotedSlippageBps }).signers([agent]).rpc();
  } catch (e) { reverted = (e as Error).message.includes("SlippageExceeded"); }
  ok(reverted, "over-slippage payment reverted with SlippageExceeded");
  ok(await balance(merchant.publicKey) === mBefore2, "no funds moved on slippage breach (atomic)");

  console.log("\nE2E-3 PASSED ✅");
}
main().catch((e) => { console.error("\nE2E-3 FAILED ❌", e.message ?? e); process.exit(1); });
