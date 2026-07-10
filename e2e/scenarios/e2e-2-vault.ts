/**
 * E2E-2: Alice creates a $50 vault for agent A → agent pays merchant M $10 in
 * USDC → Alice sees updated spent/remaining → Alice reclaims $40 → agent's next
 * pay fails.
 *
 *   npm run e2e:2
 */
import { Keypair } from "@solana/web3.js";
import { head, ok, conn, actors, ata, balance, fundFromAlice, usd, fromUsd, TEST_MINT } from "./_shared.ts";
import {
  makeProgram, vaultPda, vaultAta,
  createVaultIx, agentPayIx, reclaimIx, fetchVault, type Policy,
} from "../../shared/vault.ts";

async function main() {
  const { payer, alice, merchant } = actors;
  const program = makeProgram(conn, payer);
  const agent = Keypair.generate(); // agent A (fresh, holds no SOL — it only directs)

  head("Alice creates a $50 vault for agent A (tier-1 policy)");
  const policy: Policy = { maxPerTx: usd(25), maxSlippageBps: 100, dailyLimit: null, merchantAllowlist: null, approvalThreshold: null, expiry: null };
  await createVaultIx(program, alice.publicKey, agent.publicKey, TEST_MINT, policy).signers([alice]).rpc();
  const [vault] = vaultPda(alice.publicKey, agent.publicKey);
  await fundFromAlice(vaultAta(vault, TEST_MINT), usd(50)); // owner funds the vault from her balance
  ok(await balance(vault) === usd(50), "vault funded with $50 (remaining allowance)");

  head("Agent A pays merchant M $10 in USDC");
  const merchantAta = await ata(merchant.publicKey);
  const mBefore = await balance(merchant.publicKey);
  await agentPayIx(program, alice.publicKey, agent.publicKey, TEST_MINT, merchantAta, TEST_MINT, usd(10), { usdcDebit: usd(10), quotedSlippageBps: 0 }).signers([agent]).rpc();
  ok(await balance(merchant.publicKey) - mBefore === usd(10), "merchant received $10");

  head("Alice sees updated spent / remaining");
  const v = await fetchVault(program, alice.publicKey, agent.publicKey);
  ok(BigInt(v.lifetimeSpent.toString()) === usd(10), `lifetime_spent = $${fromUsd(usd(10))}`);
  ok(v.paymentCount === 1, "payment_count = 1");
  ok(await balance(vault) === usd(40), `remaining allowance = $${fromUsd(usd(40))}`);

  head("Alice reclaims $40 (all remaining)");
  const ownerAta = await ata(alice.publicKey);
  const oBefore = await balance(alice.publicKey);
  await reclaimIx(program, alice.publicKey, agent.publicKey, TEST_MINT, ownerAta, null, false).signers([alice]).rpc();
  ok(await balance(alice.publicKey) - oBefore === usd(40), "alice reclaimed $40");
  ok(await balance(vault) === 0n, "vault emptied");

  head("Agent A's next pay fails (no funds)");
  let failed = false;
  try {
    await agentPayIx(program, alice.publicKey, agent.publicKey, TEST_MINT, merchantAta, TEST_MINT, usd(5), { usdcDebit: usd(5), quotedSlippageBps: 0 }).signers([agent]).rpc();
  } catch (e) { failed = (e as Error).message.includes("InsufficientFunds"); }
  ok(failed, "agent pay after reclaim fails with InsufficientFunds");

  console.log("\nE2E-2 PASSED ✅");
}
main().catch((e) => { console.error("\nE2E-2 FAILED ❌", e.message ?? e); process.exit(1); });
