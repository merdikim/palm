/**
 * E2E-1: Alice deposits → privately transfers to Bob → Bob withdraws.
 * The user-balance path, TEE-native (see spikes S2).
 *
 *   npm run e2e:1
 */
import { readFileSync } from "node:fs";
import { PublicKey } from "@solana/web3.js";
import { getAccount, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { actors, magicBaseConn, sleep } from "../../shared/solana.ts";
import { buildDeposit, buildWithdraw, buildTransfer, signAndSend, connections } from "../../shared/payments.ts";
import { teeAuth, readTeeBalance, submitTeeTx } from "../../shared/tee.ts";
import { TEE_VALIDATOR_IDENTITY } from "../../shared/constants.ts";

const MINT = new PublicKey(JSON.parse(readFileSync(new URL("../../shared/deployment.json", import.meta.url), "utf8")).testMint);
const V = TEE_VALIDATOR_IDENTITY;
const ok = (c: unknown, m: string) => { if (!c) throw new Error(`ASSERT FAILED: ${m}`); console.log(`  ✓ ${m}`); };
const head = (t: string) => console.log(`\n=== ${t} ===`);

async function main() {
  const { alice, bob } = actors;
  const conns = connections();
  const base = magicBaseConn();
  const aSess = await teeAuth(alice), bSess = await teeAuth(bob);

  head("Alice deposits $25 into the private (TEE) rollup");
  const a0 = await readTeeBalance(alice.publicKey, MINT, aSess.token);
  await signAndSend(await buildDeposit({ owner: alice.publicKey.toBase58(), amount: 25_000_000, mint: MINT.toBase58(), validator: V }), [alice], conns);
  await sleep(4000);
  ok((await readTeeBalance(alice.publicKey, MINT, aSess.token)) >= a0 + 25_000_000n, "alice private balance +$25");

  head("Onboard Bob (first deposit delegates his ATA so he can receive)");
  const b0 = await readTeeBalance(bob.publicKey, MINT, bSess.token);
  await signAndSend(await buildDeposit({ owner: bob.publicKey.toBase58(), amount: 1_000_000, mint: MINT.toBase58(), validator: V }), [bob], conns);
  await sleep(4000);

  head("Alice privately transfers $15 to Bob");
  const bBefore = await readTeeBalance(bob.publicKey, MINT, bSess.token);
  const xfer = await buildTransfer({ from: alice.publicKey.toBase58(), to: bob.publicKey.toBase58(), amount: 15_000_000, mint: MINT.toBase58(), visibility: "private", fromBalance: "ephemeral", toBalance: "ephemeral", validator: V }, aSess.token);
  await submitTeeTx(xfer.transactionBase64, [alice], aSess.token, xfer.recentBlockhash, xfer.lastValidBlockHeight);
  let bAfter = bBefore;
  for (let i = 0; i < 15 && bAfter < bBefore + 15_000_000n; i++) { await sleep(2000); bAfter = await readTeeBalance(bob.publicKey, MINT, bSess.token); }
  ok(bAfter >= bBefore + 15_000_000n, "bob private balance +$15");

  head("Bob withdraws $15 back to base");
  const bobBaseAta = getAssociatedTokenAddressSync(MINT, bob.publicKey);
  const baseBefore = BigInt((await getAccount(base, bobBaseAta)).amount);
  await signAndSend(await buildWithdraw({ owner: bob.publicKey.toBase58(), amount: 15_000_000, mint: MINT.toBase58(), validator: V }), [bob], conns);
  await sleep(8000);
  ok(BigInt((await getAccount(base, bobBaseAta)).amount) > baseBefore, "bob base balance increased after withdraw");

  console.log("\nE2E-1 PASSED ✅");
}
main().catch((e) => { console.error("\nE2E-1 FAILED ❌", e.message ?? e); process.exit(1); });
