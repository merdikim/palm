/**
 * Program integration tests — every policy branch of the vault program, run
 * live against the deployed program on devnet (base layer; the policy logic and
 * escrow-PDA debit are identical whether or not the accounts are ER-delegated).
 *
 * Validates S3 (agent signs, vault PDA is the token authority) and all the
 * non-negotiable properties from the build spec.
 *
 *   npm run test:program
 */
import { readFileSync } from "node:fs";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount, mintTo, getAccount, createAssociatedTokenAccountIdempotent,
} from "@solana/spl-token";
import { actors, magicBaseConn, sleep } from "../shared/solana.ts";
import {
  makeProgram, vaultPda, vaultAta, counterPda,
  createVaultIx, agentPayIx, reclaimIx, updatePolicyIx,
  createRequestIx, requestAgentApprovalIx, respondRequestIx,
  fetchVault, fetchRequest, type Policy, type Quote,
} from "../shared/vault.ts";

const MINT = new PublicKey(JSON.parse(readFileSync(new URL("../shared/deployment.json", import.meta.url), "utf8")).testMint);
const conn = magicBaseConn();
const payer = actors.payer;      // fee payer + mint authority
const alice = actors.alice;      // vault owner
const bob = actors.bob;
const carol = actors.carol;      // non-owner attacker
const merchant = actors.merchant;
const program = makeProgram(conn, payer);

const usdc = (n: number) => BigInt(Math.round(n * 1e6));
const memo = new Array(32).fill(0);
const nowSec = () => BigInt(Math.floor(Date.now() / 1000));

let pass = 0, fail = 0;
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${(e as Error).message.split("\n")[0]}`); fail++; }
}
async function expectFail(name: string, p: Promise<unknown>, codeSubstr: string) {
  try { await p; throw new Error(`expected failure containing "${codeSubstr}" but it succeeded`); }
  catch (e) {
    const msg = (e as Error).message;
    if (msg.includes("but it succeeded")) throw e;
    if (!msg.includes(codeSubstr)) throw new Error(`expected "${codeSubstr}", got: ${msg.split("\n")[0]}`);
  }
}

const DEFAULT_POLICY: Policy = {
  maxPerTx: usdc(50), maxSlippageBps: 100, dailyLimit: null,
  merchantAllowlist: null, approvalThreshold: null, expiry: null,
};

/** Create a fresh vault (new agent => new PDA) and fund its USDC ATA. */
async function freshVault(policy: Policy, fund: bigint): Promise<Keypair> {
  const agent = Keypair.generate();
  await createVaultIx(program, alice.publicKey, agent.publicKey, MINT, policy)
    .signers([alice]).rpc();
  const [vault] = vaultPda(alice.publicKey, agent.publicKey);
  await mintTo(conn, payer, MINT, vaultAta(vault, MINT), payer, fund); // payer = mint authority
  return agent;
}
async function ataOf(owner: PublicKey): Promise<PublicKey> {
  return (await getOrCreateAssociatedTokenAccount(conn, payer, MINT, owner, true)).address;
}
const bal = async (ata: PublicKey) => (await getAccount(conn, ata)).amount;

async function main() {
  console.log(`\nProgram tests — vault ${program.programId.toBase58()} on devnet\n`);
  const merchantAta = await ataOf(merchant.publicKey);

  await test("create_vault + agent_pay happy path (escrow PDA debit)", async () => {
    const agent = await freshVault(DEFAULT_POLICY, usdc(100));
    const before = await bal(merchantAta);
    await agentPayIx(program, alice.publicKey, agent.publicKey, MINT, merchantAta, MINT, usdc(10), { usdcDebit: usdc(10), quotedSlippageBps: 0 })
      .signers([agent]).rpc();
    const after = await bal(merchantAta);
    if (after - before !== usdc(10)) throw new Error(`merchant delta ${after - before} != 10`);
    const v = await fetchVault(program, alice.publicKey, agent.publicKey);
    if (BigInt(v.lifetimeSpent.toString()) !== usdc(10)) throw new Error("lifetime_spent wrong");
    if (v.paymentCount !== 1) throw new Error("payment_count wrong");
  });

  await test("agent_pay per-tx cap enforced", async () => {
    const agent = await freshVault(DEFAULT_POLICY, usdc(100));
    await expectFail("over cap", agentPayIx(program, alice.publicKey, agent.publicKey, MINT, merchantAta, MINT, usdc(51), { usdcDebit: usdc(51), quotedSlippageBps: 0 }).signers([agent]).rpc(), "ExceedsPerTx");
  });

  await test("agent_pay slippage bound enforced", async () => {
    const agent = await freshVault(DEFAULT_POLICY, usdc(100));
    await expectFail("over slippage", agentPayIx(program, alice.publicKey, agent.publicKey, MINT, merchantAta, MINT, usdc(10), { usdcDebit: usdc(10), quotedSlippageBps: 101 }).signers([agent]).rpc(), "SlippageExceeded");
  });

  await test("agent cannot pay itself (no allowlist)", async () => {
    const agent = await freshVault(DEFAULT_POLICY, usdc(100));
    const agentAta = await ataOf(agent.publicKey);
    await expectFail("self pay", agentPayIx(program, alice.publicKey, agent.publicKey, MINT, agentAta, MINT, usdc(5), { usdcDebit: usdc(5), quotedSlippageBps: 0 }).signers([agent]).rpc(), "AgentSelfPay");
  });

  await test("allowlist: hit succeeds, miss rejected", async () => {
    const agent = Keypair.generate();
    const [vault] = vaultPda(alice.publicKey, agent.publicKey);
    const policy: Policy = { ...DEFAULT_POLICY, merchantAllowlist: [merchant.publicKey] };
    await createVaultIx(program, alice.publicKey, agent.publicKey, MINT, policy).signers([alice]).rpc();
    await mintTo(conn, payer, MINT, vaultAta(vault, MINT), payer, usdc(100));
    // hit
    await agentPayIx(program, alice.publicKey, agent.publicKey, MINT, merchantAta, MINT, usdc(3), { usdcDebit: usdc(3), quotedSlippageBps: 0 }).signers([agent]).rpc();
    // miss
    const carolAta = await ataOf(carol.publicKey);
    await expectFail("not allowed", agentPayIx(program, alice.publicKey, agent.publicKey, MINT, carolAta, MINT, usdc(3), { usdcDebit: usdc(3), quotedSlippageBps: 0 }).signers([agent]).rpc(), "MerchantNotAllowed");
  });

  await test("daily limit enforced (projection)", async () => {
    const agent = await freshVault({ ...DEFAULT_POLICY, dailyLimit: usdc(30) }, usdc(100));
    await agentPayIx(program, alice.publicKey, agent.publicKey, MINT, merchantAta, MINT, usdc(25), { usdcDebit: usdc(25), quotedSlippageBps: 0 }).signers([agent]).rpc();
    await expectFail("over daily", agentPayIx(program, alice.publicKey, agent.publicKey, MINT, merchantAta, MINT, usdc(6), { usdcDebit: usdc(6), quotedSlippageBps: 0 }).signers([agent]).rpc(), "ExceedsDailyLimit");
    // exactly to the limit is fine
    await agentPayIx(program, alice.publicKey, agent.publicKey, MINT, merchantAta, MINT, usdc(5), { usdcDebit: usdc(5), quotedSlippageBps: 0 }).signers([agent]).rpc();
  });

  await test("insufficient funds rejected", async () => {
    const agent = await freshVault(DEFAULT_POLICY, usdc(2));
    await expectFail("insufficient", agentPayIx(program, alice.publicKey, agent.publicKey, MINT, merchantAta, MINT, usdc(5), { usdcDebit: usdc(5), quotedSlippageBps: 0 }).signers([agent]).rpc(), "InsufficientFunds");
  });

  await test("over-threshold agent_pay returns ApprovalRequired, no funds move", async () => {
    const agent = await freshVault({ ...DEFAULT_POLICY, maxPerTx: usdc(500), approvalThreshold: usdc(100) }, usdc(300));
    const [vault] = vaultPda(alice.publicKey, agent.publicKey);
    const before = await bal(vaultAta(vault, MINT));
    await expectFail("threshold", agentPayIx(program, alice.publicKey, agent.publicKey, MINT, merchantAta, MINT, usdc(250), { usdcDebit: usdc(250), quotedSlippageBps: 0 }).signers([agent]).rpc(), "ApprovalRequired");
    if (await bal(vaultAta(vault, MINT)) !== before) throw new Error("funds moved on threshold reject");
  });

  await test("approval flow: request created -> owner approves -> executes", async () => {
    const agent = await freshVault({ ...DEFAULT_POLICY, maxPerTx: usdc(500), approvalThreshold: usdc(100) }, usdc(300));
    const [counter] = counterPda(alice.publicKey);
    let nextId = 0n;
    try { nextId = BigInt((await program.account.requestCounter.fetch(counter)).nextId.toString()); } catch { nextId = 0n; }
    const q: Quote = { usdcDebit: usdc(250), quotedSlippageBps: 0 };
    await requestAgentApprovalIx(program, alice.publicKey, agent.publicKey, nextId, MINT, usdc(250), q, nowSec() + 3600n, memo, payer.publicKey).signers([agent]).rpc();
    const req = await fetchRequest(program, alice.publicKey, nextId);
    if (Object.keys(req.status)[0] !== "pending") throw new Error("request not pending");
    const [vault] = vaultPda(alice.publicKey, agent.publicKey);
    const mBefore = await bal(merchantAta);
    await respondRequestIx(program, alice.publicKey, nextId, true, q, {
      vault, vaultUsdc: vaultAta(vault, MINT), destUsdc: merchantAta,
    }).signers([alice]).rpc();
    if (await bal(merchantAta) - mBefore !== usdc(250)) throw new Error("approval did not execute payment");
    const req2 = await fetchRequest(program, alice.publicKey, nextId);
    if (Object.keys(req2.status)[0] !== "accepted") throw new Error("request not accepted");
  });

  await test("reclaim mid-lifecycle returns funds to owner", async () => {
    const agent = await freshVault(DEFAULT_POLICY, usdc(100));
    const ownerAta = await ataOf(alice.publicKey);
    const before = await bal(ownerAta);
    await reclaimIx(program, alice.publicKey, agent.publicKey, MINT, ownerAta, usdc(40), false).signers([alice]).rpc();
    if (await bal(ownerAta) - before !== usdc(40)) throw new Error("reclaim amount wrong");
    const [vault] = vaultPda(alice.publicKey, agent.publicKey);
    if (await bal(vaultAta(vault, MINT)) !== usdc(60)) throw new Error("vault balance after reclaim wrong");
  });

  await test("non-owner cannot update_policy", async () => {
    const agent = await freshVault(DEFAULT_POLICY, usdc(10));
    // carol tries to update alice's vault (seeds derive from carol => wrong PDA / has_one owner)
    await expectFail("carol update", updatePolicyIx(program, carol.publicKey, agent.publicKey, DEFAULT_POLICY).signers([carol]).rpc(), "");
  });

  await test("non-owner cannot reclaim", async () => {
    const agent = await freshVault(DEFAULT_POLICY, usdc(10));
    const carolAta = await ataOf(carol.publicKey);
    await expectFail("carol reclaim", reclaimIx(program, carol.publicKey, agent.publicKey, MINT, carolAta, null, false).signers([carol]).rpc(), "");
  });

  await test("user-to-user request: create -> accept -> pays; double-respond rejected", async () => {
    // Bob requests 4 tUSD from alice; alice (payer) accepts, paying from her own account.
    const [counter] = counterPda(alice.publicKey);
    let nextId = 0n;
    try { nextId = BigInt((await program.account.requestCounter.fetch(counter)).nextId.toString()); } catch { nextId = 0n; }
    await createRequestIx(program, bob.publicKey, alice.publicKey, nextId, MINT, usdc(4), nowSec() + 3600n, memo).signers([bob]).rpc();
    const aliceAta = await ataOf(alice.publicKey);
    const bobAta = await ataOf(bob.publicKey);
    const q: Quote = { usdcDebit: usdc(4), quotedSlippageBps: 0 };
    const bobBefore = await bal(bobAta);
    await respondRequestIx(program, alice.publicKey, nextId, true, q, { payerSource: aliceAta, destUsdc: bobAta }).signers([alice]).rpc();
    if (await bal(bobAta) - bobBefore !== usdc(4)) throw new Error("user-to-user payment didn't land");
    // double respond
    await expectFail("double respond", respondRequestIx(program, alice.publicKey, nextId, true, q, { payerSource: aliceAta, destUsdc: bobAta }).signers([alice]).rpc(), "RequestNotPending");
  });

  await test("request expiry: respond after expiry marks Expired, no transfer", async () => {
    const [counter] = counterPda(alice.publicKey);
    let nextId = 0n;
    try { nextId = BigInt((await program.account.requestCounter.fetch(counter)).nextId.toString()); } catch { nextId = 0n; }
    await createRequestIx(program, bob.publicKey, alice.publicKey, nextId, MINT, usdc(4), nowSec() + 2n, memo).signers([bob]).rpc();
    await sleep(4000);
    const aliceAta = await ataOf(alice.publicKey);
    const bobAta = await ataOf(bob.publicKey);
    const bobBefore = await bal(bobAta);
    await respondRequestIx(program, alice.publicKey, nextId, true, { usdcDebit: usdc(4), quotedSlippageBps: 0 }, { payerSource: aliceAta, destUsdc: bobAta }).signers([alice]).rpc();
    if (await bal(bobAta) !== bobBefore) throw new Error("expired request still transferred");
    const req = await fetchRequest(program, alice.publicKey, nextId);
    if (Object.keys(req.status)[0] !== "expired") throw new Error("status not expired");
  });

  console.log(`\n${fail === 0 ? "ALL PASSED ✅" : "SOME FAILED ❌"}  ${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
