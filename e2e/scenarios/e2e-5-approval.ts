/**
 * E2E-5: High-value vault with approval_threshold = $100 → agent attempts $250 →
 * request created, no funds move → Alice approves → payment executes with policy
 * re-checked at approval time.
 *
 *   npm run e2e:5
 */
import { Keypair } from "@solana/web3.js";
import { head, ok, conn, actors, ata, balance, fundFromAlice, usd, TEST_MINT } from "./_shared.ts";
import {
  makeProgram, vaultPda, vaultAta, counterPda,
  createVaultIx, agentPayIx, requestAgentApprovalIx, respondRequestIx, fetchRequest, type Policy, type Quote,
} from "../../shared/vault.ts";

async function main() {
  const { payer, alice, merchant } = actors;
  const program = makeProgram(conn, payer);
  const agent = Keypair.generate();
  const memo = new Array(32).fill(0);
  const nowSec = () => BigInt(Math.floor(Date.now() / 1000));

  head("Alice creates a high-value vault (max $500, approval_threshold $100), funds $300");
  const policy: Policy = { maxPerTx: usd(500), maxSlippageBps: 100, dailyLimit: null, merchantAllowlist: null, approvalThreshold: usd(100), expiry: null };
  await createVaultIx(program, alice.publicKey, agent.publicKey, TEST_MINT, policy).signers([alice]).rpc();
  const [vault] = vaultPda(alice.publicKey, agent.publicKey);
  await fundFromAlice(vaultAta(vault, TEST_MINT), usd(300));
  const merchantAta = await ata(merchant.publicKey);

  head("Agent attempts $250 (over threshold) via agent_pay → rejected, no funds move");
  const vaultBefore = await balance(vault);
  let rejected = false;
  try {
    await agentPayIx(program, alice.publicKey, agent.publicKey, TEST_MINT, merchantAta, TEST_MINT, usd(250), { usdcDebit: usd(250), quotedSlippageBps: 0 }).signers([agent]).rpc();
  } catch (e) { rejected = (e as Error).message.includes("ApprovalRequired"); }
  ok(rejected, "agent_pay over threshold returns ApprovalRequired");
  ok(await balance(vault) === vaultBefore, "no funds moved");

  head("Agent creates an approval request for the owner");
  const [counter] = counterPda(alice.publicKey);
  let nextId = 0n;
  try { nextId = BigInt((await program.account.requestCounter.fetch(counter)).nextId.toString()); } catch {}
  const q: Quote = { usdcDebit: usd(250), quotedSlippageBps: 0 };
  await requestAgentApprovalIx(program, alice.publicKey, agent.publicKey, nextId, TEST_MINT, usd(250), q, nowSec() + 3600n, memo, payer.publicKey).signers([agent]).rpc();
  ok(Object.keys((await fetchRequest(program, alice.publicKey, nextId)).status)[0] === "pending", "approval request is Pending");

  head("Alice approves → payment executes with policy re-checked");
  const mBefore = await balance(merchant.publicKey);
  await respondRequestIx(program, alice.publicKey, nextId, true, q, { vault, vaultUsdc: vaultAta(vault, TEST_MINT), destUsdc: merchantAta }).signers([alice]).rpc();
  ok(await balance(merchant.publicKey) - mBefore === usd(250), "merchant received $250 after approval");
  ok(Object.keys((await fetchRequest(program, alice.publicKey, nextId)).status)[0] === "accepted", "request marked Accepted");

  console.log("\nE2E-5 PASSED ✅");
}
main().catch((e) => { console.error("\nE2E-5 FAILED ❌", e.message ?? e); process.exit(1); });
