/**
 * S2 — Private Payments API loop, unified on the TEE validator.
 *
 * challenge→sign→login (TEE-native /auth); deposit tUSD into the TEE ER;
 * private transfer alice→bob; read private balances directly from the TEE RPC;
 * withdraw back to base. Uses our self-controlled test mint (TEE-initialized).
 *
 * See docs/spikes.md S2 for why the user path is TEE-native (build via hosted
 * API, read+submit via the TEE RPC with its own ?token=).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Keypair, PublicKey } from "@solana/web3.js";
import { actors, section, assert, sleep, baseConn } from "../../shared/solana.ts";
import {
  buildDeposit, buildWithdraw, buildTransfer, signAndSend, connections,
} from "../../shared/payments.ts";
import { teeAuth, readTeeBalance, submitTeeTx } from "../../shared/tee.ts";
import { TEE_VALIDATOR_IDENTITY } from "../../shared/constants.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MINT = new PublicKey(
  JSON.parse(readFileSync(join(__dirname, "..", "..", "shared", "deployment.json"), "utf8")).testMint,
);
const V = TEE_VALIDATOR_IDENTITY;
const conns = connections();
const byPubkey = new Map(
  [actors.alice, actors.bob, actors.agent, actors.merchant, actors.payer].map((k) => [k.publicKey.toBase58(), k]),
);
const signersFor = (req: string[]): Keypair[] => req.map((p) => {
  const k = byPubkey.get(p); if (!k) throw new Error(`no keypair for ${p}`); return k;
});

async function main() {
  const alice = actors.alice, bob = actors.bob;
  console.log(`mint = ${MINT.toBase58()} (TEE validator ${V})`);

  section("Auth: TEE-native challenge -> login for alice & bob");
  const aliceSess = await teeAuth(alice);
  const bobSess = await teeAuth(bob);
  assert(aliceSess.token && bobSess.token, "both wallets got TEE bearer tokens");

  section("Deposit 100 tUSD alice base -> TEE ER");
  const aliceStart = await readTeeBalance(alice.publicKey, MINT, aliceSess.token);
  const dep = await buildDeposit({ owner: alice.publicKey.toBase58(), amount: 100_000_000, mint: MINT.toBase58(), validator: V });
  console.log(`  requiredSigners=${dep.requiredSigners.join(",")} sendTo=${dep.sendTo}`);
  const depSig = await signAndSend(dep, signersFor(dep.requiredSigners), conns);
  console.log(`  deposit sig ${depSig}`);
  await sleep(4000);
  const aliceAfterDep = await readTeeBalance(alice.publicKey, MINT, aliceSess.token);
  console.log(`  alice private balance: ${aliceStart} -> ${aliceAfterDep}`);
  assert(aliceAfterDep >= aliceStart + 100_000_000n, "alice private balance +100 tUSD after deposit");

  section("Onboard bob: deposit 1 tUSD so his ER ATA is delegated (needed to RECEIVE)");
  // An ER->ER transfer writes the recipient's ATA, which must be delegated to
  // the TEE ER. A first deposit delegates it. Without this the transfer fails
  // with InvalidWritableAccount (Phase 0 finding).
  const bobStart = await readTeeBalance(bob.publicKey, MINT, bobSess.token);
  const bobDep = await buildDeposit({ owner: bob.publicKey.toBase58(), amount: 1_000_000, mint: MINT.toBase58(), validator: V });
  await signAndSend(bobDep, signersFor(bobDep.requiredSigners), conns);
  await sleep(4000);
  assert((await readTeeBalance(bob.publicKey, MINT, bobSess.token)) >= bobStart + 1_000_000n, "bob onboarded (ATA delegated)");

  section("Private transfer alice -> bob 30 tUSD (TEE ER -> ER)");
  const bobBefore = await readTeeBalance(bob.publicKey, MINT, bobSess.token);
  const xfer = await buildTransfer(
    { from: alice.publicKey.toBase58(), to: bob.publicKey.toBase58(), amount: 30_000_000,
      mint: MINT.toBase58(), visibility: "private", fromBalance: "ephemeral", toBalance: "ephemeral", validator: V },
    aliceSess.token,
  );
  console.log(`  requiredSigners=${xfer.requiredSigners.join(",")} sendTo=${xfer.sendTo} version=${xfer.version}`);
  const xferSig = await submitTeeTx(
    xfer.transactionBase64, signersFor(xfer.requiredSigners), aliceSess.token, xfer.recentBlockhash, xfer.lastValidBlockHeight,
  );
  console.log(`  transfer sig ${xferSig}`);

  section("Poll bob private balance (private transfers settle async)");
  let bobAfter = bobBefore;
  for (let i = 0; i < 20; i++) {
    await sleep(2000);
    bobAfter = await readTeeBalance(bob.publicKey, MINT, bobSess.token);
    console.log(`  [${i}] bob private balance: ${bobAfter}`);
    if (bobAfter >= bobBefore + 30_000_000n) break;
  }
  assert(bobAfter >= bobBefore + 30_000_000n, "bob private balance +30 tUSD");

  section("Bob withdraws 30 tUSD TEE ER -> base");
  const base = baseConn();
  const bobBaseAta = (await import("@solana/spl-token")).getAssociatedTokenAddressSync(MINT, bob.publicKey);
  const bobBaseBefore = BigInt((await base.getTokenAccountBalance(bobBaseAta)).value.amount);
  const wd = await buildWithdraw({ owner: bob.publicKey.toBase58(), amount: 30_000_000, mint: MINT.toBase58(), validator: V });
  console.log(`  requiredSigners=${wd.requiredSigners.join(",")} sendTo=${wd.sendTo}`);
  const wdSig = await signAndSend(wd, signersFor(wd.requiredSigners), conns);
  console.log(`  withdraw sig ${wdSig}`);
  await sleep(8000);
  const bobBaseAfter = BigInt((await base.getTokenAccountBalance(bobBaseAta)).value.amount);
  console.log(`  bob base balance ${bobBaseBefore} -> ${bobBaseAfter}`);
  assert(bobBaseAfter > bobBaseBefore, "bob base balance increased after withdraw");

  console.log("\nS2 PASSED ✅  full TEE deposit/transfer/withdraw loop works on devnet");
}

main().catch((e) => { console.error("\nS2 FAILED ❌", e.message ?? e); process.exit(1); });
