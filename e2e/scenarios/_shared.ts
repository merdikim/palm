/** Shared helpers for e2e scenario scripts. */
import { readFileSync } from "node:fs";
import { PublicKey } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount, getAccount, transfer } from "@solana/spl-token";
import { actors, magicBaseConn } from "../../shared/solana.ts";

export const deployment = JSON.parse(
  readFileSync(new URL("../../shared/deployment.json", import.meta.url), "utf8"),
) as { testMint: string; userMint: string };

export const TEST_MINT = new PublicKey(deployment.testMint);
export const usd = (n: number) => BigInt(Math.round(n * 1e6));
export const fromUsd = (b: bigint) => (Number(b) / 1e6).toFixed(2);

export function ok(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
  console.log(`  ✓ ${msg}`);
}
export function head(t: string) { console.log(`\n=== ${t} ===`); }

export const conn = magicBaseConn();
export { actors };

export async function ata(owner: PublicKey, mint = TEST_MINT): Promise<PublicKey> {
  const payer = actors.payer;
  return (await getOrCreateAssociatedTokenAccount(conn, payer, mint, owner, true)).address;
}
export async function balance(owner: PublicKey, mint = TEST_MINT): Promise<bigint> {
  return (await getAccount(conn, await ata(owner, mint))).amount;
}
/** Fund a vault (or any account) by transferring testMint from alice's base ATA. */
export async function fundFromAlice(destAta: PublicKey, amount: bigint) {
  const alice = actors.alice;
  const aliceAta = await ata(alice.publicKey);
  await transfer(conn, actors.payer, aliceAta, destAta, alice, amount);
}
