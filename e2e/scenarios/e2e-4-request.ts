/**
 * E2E-4: Bob requests $20 from Alice → relay pushes an OPAQUE notification →
 * Alice reads the request → accepts → Bob's balance increases.
 *
 * The relay runs in-process with a MockPusher so we can assert the push payload
 * is content-free (only {type, id}). On-chain, the request + accept use the
 * vault program's user-to-user path.
 *
 *   npm run e2e:4
 */
import { head, ok, conn, actors, ata, balance, usd, TEST_MINT } from "./_shared.ts";
import { makeProgram, counterPda, requestPda, createRequestIx, respondRequestIx, fetchRequest, type Quote } from "../../shared/vault.ts";
import { buildServer } from "../../backend/src/server.ts";
import { MockPusher } from "../../backend/src/pusher.ts";

async function main() {
  const { payer, alice, bob } = actors;
  const program = makeProgram(conn, payer);
  const memo = new Array(32).fill(0);
  const nowSec = () => BigInt(Math.floor(Date.now() / 1000));

  head("Bob requests $20 from Alice (on-chain, members {requester=bob, payer=alice})");
  const [counter] = counterPda(alice.publicKey);
  let nextId = 0n;
  try { nextId = BigInt((await program.account.requestCounter.fetch(counter)).nextId.toString()); } catch {}
  await createRequestIx(program, bob.publicKey, alice.publicKey, nextId, TEST_MINT, usd(20), nowSec() + 3600n, memo).signers([bob]).rpc();
  const [reqPda] = requestPda(alice.publicKey, nextId);
  ok(Object.keys((await fetchRequest(program, alice.publicKey, nextId)).status)[0] === "pending", "request created, Pending");

  head("Relay pushes an OPAQUE notification to Alice (content-free)");
  const mock = new MockPusher();
  const relay = buildServer(mock, { logger: false });
  const aliceToken = "ExponentPushToken[alicedevicexxxxxxxxx]";
  const reg = await relay.inject({ method: "POST", url: "/register", payload: { wallet: alice.publicKey.toBase58(), pushToken: aliceToken } });
  ok(reg.statusCode === 200, "alice's device registered");
  // Bob's client pings the relay after creating the request — type + opaque id only.
  const notif = await relay.inject({ method: "POST", url: "/notify", payload: { targetWallet: alice.publicKey.toBase58(), type: "new_request", id: reqPda.toBase58() } });
  ok(notif.statusCode === 200, "relay accepted the notify");
  ok(mock.calls.length === 1, "exactly one push sent to alice");
  const pushed = mock.calls[0].message;
  ok(JSON.stringify(pushed.data) === JSON.stringify({ type: "new_request", id: reqPda.toBase58() }), "push data is exactly {type, id}");
  const serialized = JSON.stringify(pushed);
  ok(!serialized.includes("20") && !serialized.includes(TEST_MINT.toBase58()) && !serialized.includes(bob.publicKey.toBase58()), "push reveals no amount / mint / counterparty");
  await relay.close();

  head("Alice reads the request and accepts → Bob's balance increases");
  const aliceAta = await ata(alice.publicKey);
  const bobAta = await ata(bob.publicKey);
  const bobBefore = await balance(bob.publicKey);
  const q: Quote = { usdcDebit: usd(20), quotedSlippageBps: 0 };
  await respondRequestIx(program, alice.publicKey, nextId, true, q, { payerSource: aliceAta, destUsdc: bobAta }).signers([alice]).rpc();
  ok(await balance(bob.publicKey) - bobBefore === usd(20), "bob received $20");
  ok(Object.keys((await fetchRequest(program, alice.publicKey, nextId)).status)[0] === "accepted", "request Accepted");

  console.log("\nE2E-4 PASSED ✅");
}
main().catch((e) => { console.error("\nE2E-4 FAILED ❌", e.message ?? e); process.exit(1); });
