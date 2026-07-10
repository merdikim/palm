# Phase 0 — Spike findings

All spikes run against **Solana devnet** + the **MagicBlock devnet TEE validator**
(`MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo`, endpoint `devnet-tee.magicblock.app`,
`magicblock-core 0.13.4` / `solana-core 4.0.0`). Test actors + a self-controlled
6-decimal test mint (`tUSD`, TEE-initialized) are set up by
`npm run setup:mint`. Runnable spike scripts live in `e2e/spikes/`.

Legend: ✅ works · ⚠️ works with a documented constraint/fallback · 🔜 validated
by the program test-suite (Deliverable D) rather than a standalone script.

---

## S1 — Baseline PER read-gating  ✅ (core mechanism proven; full flow → 🔜 program tests)

**Goal:** delegate a PDA, init permission, set privacy, read with an auth token,
confirm a non-member is blocked, commit + undelegate.

**Findings (proven live):**
- The TEE ER exposes its own auth: `GET {er}/auth/challenge?pubkey=…` →
  `POST {er}/auth/login {pubkey,challenge,signature}` → a **JWT**. This is a
  *different* token issuer than the hosted Payments API. The SDK's
  `getAuthToken(rpcUrl, pubkey, signMessage)` implements exactly this.
- The token is passed to the ER RPC as a **`?token=<jwt>` URL query param**
  (not an `Authorization` header). RPC calls without it, or with a foreign
  service's token, are rejected/filtered.
- **Ingress privacy is real and enforced by the query-filtering service:**
  reading a private account with the owner's token returns the data; reading it
  with **no token returns `value: null`**; reading it with a **third party's own
  valid token also returns `value: null`**. Verified: `carol` (a wallet in no
  member list) could not read `alice`'s private account even though carol held a
  valid token of her own.

**Status:** the read-gating primitive that the whole product depends on is
proven. Building our *own* permissioned PDA end-to-end (`CreatePermission` +
`set_privacy(true)` + `delegate` + commit/undelegate via the access-control SDK)
is exercised by the vault program and its tests (S3 / Deliverable D), since it
requires the program to exist.

---

## S2 — Private Payments API loop  ✅ FULL PASS

`npm run spike:s2` — passes end to end on devnet TEE.

**Flow proven:** TEE-native login (alice, bob) → deposit 100 tUSD base→TEE ER →
read private balance → **onboard recipient** → private transfer alice→bob 30 tUSD
→ recipient balance +30 → withdraw 30 ER→base → base balance +30.

**Findings & the constraints they forced (these shaped `shared/tee.ts`):**

1. **The hosted API only *builds* transactions.** It never signs/submits. Client
   signs and submits to the chain named in `sendTo`.

2. **The hosted `private-balance` endpoint is bound to the API's own validator
   (`MAS1…`) and *ignores* a `validator` override** — it returned
   `EATA_DELEGATED_ELSEWHERE` for a balance we deposited to the TEE validator.
   → We do **not** use it for TEE balances.

3. **The hosted `private-balance` endpoint is NOT per-wallet private.** With her
   own token, `carol` successfully read `alice`'s balance by just passing
   `address=alice` — it never checks `address == token-wallet`. → **Never** rely
   on hosted reads for privacy. This is the decisive reason the user-balance path
   is TEE-native.

4. **Resolution — unify the user path on the TEE validator:**
   - build deposit/transfer/withdraw via the Payments API with `validator = TEE`;
   - authenticate against the **TEE RPC's own** `/auth` flow;
   - **read balances** and **submit ER transactions** directly against the TEE
     RPC with `?token=` (privacy enforced at ingress, per S1).

5. **Balance lives at the canonical ATA (Ephemeral SPL "Model A").** Deposits
   materialize as a normal SPL token account at the owner's **canonical ATA** on
   the ER — not the ESPL eATA bookkeeping account (which stays 0). Read balance =
   `getAccountInfo(canonicalATA)` amount. (This matches how the vault program
   moves funds: plain SPL Token CPI over the canonical ATA.)

6. **ER transactions need the ER's own blockhash**, not the API-supplied one
   (`Blockhash not found` otherwise). We re-stamp `recentBlockhash` from the TEE
   connection before signing (safe — we sign client-side anyway).

7. **A recipient must be "onboarded" before it can RECEIVE.** An ER→ER transfer
   *writes* the recipient's ATA, which must be delegated to the ER; otherwise the
   tx fails with **`InvalidWritableAccount`**. A first deposit by the recipient
   delegates its ATA. → onboarding is an explicit product step.

8. **`skipPreflight: true` hides on-chain failures.** Always check
   `confirmTransaction().value.err` — several "successful" submissions were
   actually failing on-chain until we started throwing on it.

9. **Read caveat:** for a *non-delegated* account the TEE RPC returns the cloned
   *base* balance, indistinguishable from a real ER balance by amount alone.
   `readTeeBalance` documents this; UIs should treat "onboarded (delegated)" as a
   state, not infer it from a nonzero read.

---

## S3 — Agent signs against a vault PDA  ⚠️→🔜 (design validated; full proof in program tests)

**Question:** can an outbound/private transfer be executed where the *source* is
a program-owned vault PDA's balance and the *signer* is a different keypair (the
agent), with the PDA signing via program seeds?

**Findings:**
- **Hosted API path: no.** The hosted transfer/swap endpoints derive the source
  from `from`/`userPublicKey` and require *that* wallet to sign. There is no way
  to have a program PDA be the authority via the hosted API. So the vault debit
  cannot go through the hosted transfer endpoint.
- **Program CPI path (Ephemeral SPL "Model A"): yes — this is the chosen path.**
  On the ER the vault's balance is a normal SPL token account at the vault PDA's
  canonical ATA. Our program moves it with a plain `token::transfer` CPI where
  the **authority is the vault PDA signing via seeds** (`invoke_signed`) while the
  **agent is only the transaction signer/fee payer**. This is the standard escrow
  pattern and needs no hosted-API involvement for the debit.
- **Decision (D4 stands):** `agent_pay` performs the policy check + debit itself
  and CPIs the SPL transfer under the vault PDA's authority. The agent can never
  become the token authority, so it can never sweep funds. Full end-to-end proof
  (agent signs, PDA authority moves funds, funds land at merchant) is in the
  vault program's test-suite (Deliverable D), since it requires the deployed
  program.

---

## S4 — Requests discovery  🔜 (validated by the program test-suite)

**Question:** can a client enumerate/read `PaymentRequest` accounts it is a
permission member of, via authenticated ER `getProgramAccounts` / subscription?

**Plan & fallback:** `PaymentRequest` PDAs are created directly on the ER with
members `{requester, payer}`. Primary path: authenticated ER
`getProgramAccounts(vaultProgram, filters=[memcmp requester|payer])` over the TEE
RPC with `?token=`. The TEE query filter (S1) governs which accounts are visible.
**Documented fallback if enumeration is filtered/unavailable:** deterministic
request PDAs seeded by `(payer, counter)` + a per-user on-chain request counter,
so a client can *derive and fetch* its pending requests by index without a scan,
and the relay hints "you have a request" by opaque id only. The program includes
the counter so the fallback is always available. Confirmed against the deployed
program in Deliverable D.

---

## S5 — Swap availability on devnet  ⚠️ mock (as the spec anticipates)

`npm run spike:s5`.

**Finding:** `/v1/swap/quote` returns **no route** on devnet for every pair tried
(USDC↔SOL, testMint→USDC): *"The token … not found"* — the underlying
Metis/Jupiter routing has no devnet liquidity.

**Decision:** the `agent_pay` swap leg sits behind a `SwapProvider` interface. On
devnet it uses a **deterministic mock** (fixed rate + configurable slippage) that
preserves **atomic-failure semantics**: either debit+swap+deliver all succeed or
nothing moves, and a slippage breach fails the whole instruction. Every non-swap
branch (caps, daily window, allowlist, threshold, atomic rollback) is fully
exercised; only the DEX call itself is stubbed. The interface lets a mainnet build
drop in the live `/v1/swap` flow unchanged.

---

## Net effect on the design

No design decision from the spec was invalidated. Two were *sharpened*:
- **D1 (user balance via hosted API):** the hosted API is used only as a
  stateless tx-builder; reads/submits are TEE-native because hosted reads are not
  private (S2#3). The user's balance still lives entirely on MagicBlock infra with
  no custody code from us.
- **D5 (swap):** stubbed on devnet per S5, behind an interface, atomic semantics
  preserved.

Everything else (per-agent escrow vault, agent-as-director, PER permission
`{owner, agent}`, requests primitive) is confirmed viable.
