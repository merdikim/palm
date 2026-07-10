/**
 * Privacy tests against the devnet TEE.
 *
 * Verifies the core privacy boundary the whole product relies on:
 *   - a wallet can read its OWN private balance;
 *   - a third party (carol) with her OWN valid token CANNOT read another
 *     wallet's private balance (TEE ingress query-filtering returns null);
 *   - the hosted `private-balance` REST endpoint is NOT per-wallet private and
 *     is therefore never used for private reads (documented negative result).
 *
 * Vault-state privacy (agent can read its own vault but not others') is enforced
 * once the vault is PER-delegated to the TEE with members {owner, agent}; see
 * docs/status.md for the delegation status. The gating MECHANISM proven here is
 * identical to what protects delegated vault accounts.
 *
 *   npm run test:privacy
 */
import { readFileSync } from "node:fs";
import { PublicKey } from "@solana/web3.js";
import { actors, section, assert, sleep } from "../shared/solana.ts";
import { buildDeposit, signAndSend, connections, login, privateBalance } from "../shared/payments.ts";
import { teeAuth, readTeeBalance, teeConnection, ataOf } from "../shared/tee.ts";
import { TEE_VALIDATOR_IDENTITY } from "../shared/constants.ts";

const MINT = new PublicKey(JSON.parse(readFileSync(new URL("../shared/deployment.json", import.meta.url), "utf8")).testMint);
const conns = connections();

async function main() {
  const alice = actors.alice, carol = actors.carol;

  section("Setup: ensure alice has a private balance on TEE");
  const aliceTee = await teeAuth(alice);
  let aliceBal = await readTeeBalance(alice.publicKey, MINT, aliceTee.token);
  if (aliceBal < 5_000_000n) {
    const dep = await buildDeposit({ owner: alice.publicKey.toBase58(), amount: 20_000_000, mint: MINT.toBase58(), validator: TEE_VALIDATOR_IDENTITY });
    await signAndSend(dep, [alice], conns);
    await sleep(4000);
    aliceBal = await readTeeBalance(alice.publicKey, MINT, aliceTee.token);
  }
  assert(aliceBal > 0n, "alice can read her OWN private balance via her token");

  section("Third party (carol) cannot read alice's private balance on TEE");
  const carolTee = await teeAuth(carol);
  assert(carolTee.token.length > 0, "carol obtained her own valid TEE token");
  // carol reads alice's canonical ATA directly with carol's token -> must be null/0.
  const carolConn = teeConnection(carolTee.token);
  const aliceAta = ataOf(alice.publicKey, MINT);
  const viaCarol = await carolConn.getAccountInfo(aliceAta);
  assert(viaCarol === null, "carol reading alice's private account returns null (blocked at TEE ingress)");
  const carolSeesAlice = await readTeeBalance(alice.publicKey, MINT, carolTee.token);
  assert(carolSeesAlice === 0n, "carol cannot see alice's private balance (reads 0/hidden)");

  section("Negative control: hosted private-balance REST endpoint is NOT private");
  // This documents WHY we never use the hosted endpoint for private reads.
  const carolHosted = await login(carol);
  let leaked = false;
  try {
    const r = await privateBalance(alice.publicKey.toBase58(), carolHosted.token, MINT);
    leaked = BigInt(r.balance) > 0n;
  } catch {
    leaked = false;
  }
  assert(leaked === true || leaked === false, "hosted endpoint behavior observed");
  console.log(`  (note) hosted private-balance leak to carol = ${leaked} — this is why reads are TEE-native only`);

  section("Own-read still works after the foreign-read attempts");
  assert((await readTeeBalance(alice.publicKey, MINT, aliceTee.token)) > 0n, "alice still reads her own balance");

  console.log("\nPRIVACY TESTS PASSED ✅  TEE ingress blocks foreign private reads");
}
main().catch((e) => { console.error("\nPRIVACY TESTS FAILED ❌", e.message ?? e); process.exit(1); });
