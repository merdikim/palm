/**
 * Setup: create a self-controlled 6-decimal test mint ("tUSD"), mint a large
 * supply to the test actors, and initialize its transfer queue on the TEE
 * validator via the Payments API.
 *
 * We use our own mint (not devnet USDC) because we cannot mint devnet USDC — a
 * self-controlled mint makes the whole spike/e2e harness repeatable without a
 * faucet. Decimals = 6 to match USDC exactly, so all policy math is identical.
 *
 * Writes the mint address to shared/deployment.json for every other script.
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { actors, magicBaseConn, section, assert } from "../../shared/solana.ts";
import { initializeMint, isMintInitialized, signAndSend, connections } from "../../shared/payments.ts";
import { TEE_VALIDATOR_IDENTITY, USDC_DECIMALS } from "../../shared/constants.ts";
import { Transaction } from "@solana/web3.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEPLOY_FILE = join(__dirname, "..", "..", "shared", "deployment.json");

function readDeployment(): Record<string, string> {
  if (existsSync(DEPLOY_FILE)) return JSON.parse(readFileSync(DEPLOY_FILE, "utf8"));
  return {};
}
function writeDeployment(d: Record<string, string>) {
  writeFileSync(DEPLOY_FILE, JSON.stringify(d, null, 2) + "\n");
}

async function main() {
  const conn = magicBaseConn();
  const payer = actors.payer;
  const deploy = readDeployment();

  section("Create test mint (tUSD, 6 decimals)");
  let mint = deploy.testMint;
  if (mint) {
    console.log(`  reusing existing test mint ${mint}`);
  } else {
    const mintPk = await createMint(conn, payer, payer.publicKey, null, USDC_DECIMALS);
    mint = mintPk.toBase58();
    console.log(`  created mint ${mint}`);
    deploy.testMint = mint;
    writeDeployment(deploy);
  }

  section("Mint supply to actors");
  const mintPk = (await import("@solana/web3.js")).PublicKey;
  const m = new mintPk(mint);
  for (const [name, kp] of [
    ["alice", actors.alice],
    ["bob", actors.bob],
    ["agent", actors.agent],
    ["merchant", actors.merchant],
  ] as const) {
    const ata = await getOrCreateAssociatedTokenAccount(conn, payer, m, kp.publicKey);
    // give alice & agent-owner funding capacity; small for others
    const amount = name === "alice" ? 10_000_000_000n : 1_000_000_000n; // 10k / 1k tUSD
    await mintTo(conn, payer, m, ata.address, payer, amount);
    console.log(`  ${name}: minted, ATA ${ata.address.toBase58()}`);
  }

  section("Initialize testMint (vault/TEE flows) on TEE validator");
  const already = await isMintInitialized(mint, TEE_VALIDATOR_IDENTITY);
  if (already.initialized) {
    console.log(`  already initialized, queue ${already.transferQueue}`);
  } else {
    const built = await initializeMint(payer.publicKey.toBase58(), mint, TEE_VALIDATOR_IDENTITY);
    console.log(`  building init tx (queue ${built.transferQueue})`);
    const sig = await signAndSend(built, [payer], connections());
    console.log(`  initialized, sig ${sig}`);
    const check = await isMintInitialized(mint, TEE_VALIDATOR_IDENTITY);
    assert(check.initialized, "testMint transfer queue initialized on TEE validator");
  }

  // ---- userMint: the hosted user-balance path lives on the API's own
  // private validator (MAS1). private-balance ignores validator overrides, so
  // this mint is initialized on the DEFAULT validator (omit validator).
  section("Create + initialize userMint (hosted user-balance flows) on MAS1");
  let userMint = deploy.userMint;
  if (userMint) {
    console.log(`  reusing userMint ${userMint}`);
  } else {
    const upk = await createMint(conn, payer, payer.publicKey, null, USDC_DECIMALS);
    userMint = upk.toBase58();
    deploy.userMint = userMint;
    writeDeployment(deploy);
    console.log(`  created userMint ${userMint}`);
    for (const [name, kp] of [["alice", actors.alice], ["bob", actors.bob], ["merchant", actors.merchant]] as const) {
      const ata = await getOrCreateAssociatedTokenAccount(conn, payer, upk, kp.publicKey);
      const amount = name === "alice" ? 10_000_000_000n : 1_000_000_000n;
      await mintTo(conn, payer, upk, ata.address, payer, amount);
      console.log(`  ${name}: userMint minted`);
    }
  }
  const uinit = await isMintInitialized(userMint); // default validator (MAS1)
  if (uinit.initialized) {
    console.log(`  userMint already initialized on MAS1, queue ${uinit.transferQueue}`);
  } else {
    const built = await initializeMint(payer.publicKey.toBase58(), userMint); // no validator => MAS1
    console.log(`  building userMint init tx on ${built.validator} (queue ${built.transferQueue})`);
    const sig = await signAndSend(built, [payer], connections());
    console.log(`  initialized, sig ${sig}`);
    const check = await isMintInitialized(userMint);
    assert(check.initialized, "userMint transfer queue initialized on MAS1");
  }

  console.log(`\nDONE.`);
  console.log(`  testMint (TEE/vault): ${mint}`);
  console.log(`  userMint (MAS1/user): ${userMint}`);
  console.log(`Written to shared/deployment.json`);
}

main().catch((e) => {
  console.error("SETUP FAILED:", e.message ?? e);
  process.exit(1);
});
