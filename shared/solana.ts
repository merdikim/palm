/** Shared Solana helpers for scripts (spikes, e2e, setup). Node-only. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Connection, Keypair } from "@solana/web3.js";
import { SOLANA_DEVNET_RPC, TEE_ER_ENDPOINT, MAGICBLOCK_BASE_RPC } from "./constants.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const KEYS_DIR = join(__dirname, "..", "keys");

export function loadKey(name: string): Keypair {
  const raw = JSON.parse(readFileSync(join(KEYS_DIR, `${name}.json`), "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

/** Named test actors used across spikes and e2e. */
export const actors = {
  get alice() { return loadKey("alice"); },
  get bob() { return loadKey("bob"); },
  get carol() { return loadKey("carol"); }, // third party — never a permission member
  get agent() { return loadKey("agent"); },
  get merchant() { return loadKey("merchant"); },
  get payer() { return loadKey("payer"); },
};

export const baseConn = () => new Connection(SOLANA_DEVNET_RPC, "confirmed");
export const magicBaseConn = () => new Connection(MAGICBLOCK_BASE_RPC, "confirmed");
export const erConn = () => new Connection(TEE_ER_ENDPOINT, "confirmed");

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Tiny assertion helper for spike/e2e scripts. */
export function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

export function section(title: string) {
  console.log(`\n${"═".repeat(4)} ${title} ${"═".repeat(Math.max(0, 60 - title.length))}`);
}
