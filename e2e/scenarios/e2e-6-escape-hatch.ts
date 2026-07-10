/**
 * E2E-6 (resilience): the validator escape hatch.
 *
 * Demonstrates that funds held privately can always be recovered back to the
 * base layer, so a user is never trapped if they stop trusting/using the ER:
 *   (a) User balance: deposit into the TEE ER, then WITHDRAW back to base — the
 *       hosted undelegate+withdraw path returns tokens to the owner's base ATA.
 *   (b) Vault: the owner can RECLAIM the vault's balance to base at any time.
 *
 * Note: the vault currently lives on base layer (its PER delegation to the TEE
 * is the documented next integration — see docs/status.md). Once delegated, the
 * escape hatch for the vault is a commit_and_undelegate followed by reclaim; the
 * reclaim half is proven here and is the part that returns funds to the owner.
 *
 *   npm run e2e:6
 */
import { readFileSync } from "node:fs";
import { Keypair, PublicKey } from "@solana/web3.js";
import { getAccount, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { actors, magicBaseConn, sleep } from "../../shared/solana.ts";
import { buildDeposit, buildWithdraw, signAndSend, connections } from "../../shared/payments.ts";
import { teeAuth, readTeeBalance } from "../../shared/tee.ts";
import { TEE_VALIDATOR_IDENTITY } from "../../shared/constants.ts";
import { makeProgram, vaultPda, vaultAta, createVaultIx, reclaimIx, type Policy } from "../../shared/vault.ts";

const MINT = new PublicKey(JSON.parse(readFileSync(new URL("../../shared/deployment.json", import.meta.url), "utf8")).testMint);
const V = TEE_VALIDATOR_IDENTITY;
const ok = (c: unknown, m: string) => { if (!c) throw new Error(`ASSERT FAILED: ${m}`); console.log(`  ✓ ${m}`); };
const head = (t: string) => console.log(`\n=== ${t} ===`);
const usd = (n: number) => BigInt(Math.round(n * 1e6));

async function main() {
  const { payer, alice, merchant } = actors;
  const base = magicBaseConn();
  const conns = connections();

  head("(a) User balance: deposit into TEE, then withdraw fully back to base");
  const aSess = await teeAuth(alice);
  const aliceBaseAta = getAssociatedTokenAddressSync(MINT, alice.publicKey);
  await signAndSend(await buildDeposit({ owner: alice.publicKey.toBase58(), amount: 10_000_000, mint: MINT.toBase58(), validator: V }), [alice], conns);
  await sleep(4000);
  const priv = await readTeeBalance(alice.publicKey, MINT, aSess.token);
  ok(priv >= 10_000_000n, "alice has a private balance in the ER");
  const baseBefore = BigInt((await getAccount(base, aliceBaseAta)).amount);
  await signAndSend(await buildWithdraw({ owner: alice.publicKey.toBase58(), amount: 10_000_000, mint: MINT.toBase58(), validator: V }), [alice], conns);
  await sleep(8000);
  ok(BigInt((await getAccount(base, aliceBaseAta)).amount) >= baseBefore + 10_000_000n, "funds recovered to base via withdraw (escape hatch)");

  head("(b) Vault: owner reclaims the vault balance to base at will");
  const program = makeProgram(base, payer);
  const agent = Keypair.generate();
  const policy: Policy = { maxPerTx: usd(25), maxSlippageBps: 100, dailyLimit: null, merchantAllowlist: null, approvalThreshold: null, expiry: null };
  await createVaultIx(program, alice.publicKey, agent.publicKey, MINT, policy).signers([alice]).rpc();
  const [vault] = vaultPda(alice.publicKey, agent.publicKey);
  // fund vault from alice's base ATA
  const { transfer } = await import("@solana/spl-token");
  await transfer(base, payer, aliceBaseAta, vaultAta(vault, MINT), alice, usd(20));
  const ownerAta = getAssociatedTokenAddressSync(MINT, alice.publicKey);
  const ownerBefore = BigInt((await getAccount(base, ownerAta)).amount);
  await reclaimIx(program, alice.publicKey, agent.publicKey, MINT, ownerAta, null, true).signers([alice]).rpc();
  ok(BigInt((await getAccount(base, ownerAta)).amount) - ownerBefore === usd(20), "vault fully reclaimed to owner (+ account closed)");

  console.log("\nE2E-6 PASSED ✅");
}
main().catch((e) => { console.error("\nE2E-6 FAILED ❌", e.message ?? e); process.exit(1); });
