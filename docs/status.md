# Project status

Rolling status, updated after each phase. Newest phase on top.

---

## Phase 0 — Spikes  ✅ complete

**What works (proven live on devnet TEE):**
- Full toolchain: Rust 1.95, Solana 3.1.15, Anchor 0.32.1, Node 24.
- Test harness: 6 funded actor keypairs, self-controlled 6-decimal test mint
  (`tUSD`), TEE-initialized. `npm run setup:mint`.
- **S2 full pass** (`npm run spike:s2`): TEE-native auth → deposit → recipient
  onboarding → private transfer → TEE-gated private balance read → withdraw.
- **Privacy gating proven**: a non-member cannot read another wallet's private
  account even with its own valid token (S1 mechanism; carol → `null`).
- Reusable client: `shared/payments.ts` (hosted API) + `shared/tee.ts`
  (TEE-native auth/read/submit) + `shared/constants.ts`.

**What's stubbed / deferred with a plan:**
- **Swap (S5)**: no devnet DEX liquidity → `SwapProvider` mock with atomic
  semantics. Live `/v1/swap` drops in for mainnet.
- **S1/S3/S4 full end-to-end**: validated by design + partial live proof; the
  program-dependent halves are proven in the vault program's test-suite.

**Decisions a human should confirm:**
1. **User balance is TEE-native, not via hosted reads** — because the hosted
   `private-balance` endpoint is not per-wallet private (S2#3). Agreed direction?
2. **Swap stubbed on devnet** — acceptable for the prototype milestone?
3. Test state on shared actor keypairs accumulates across runs; e2e uses
   fresh/onboarded state where it matters. OK for prototype.

---

## Phase 1 — Vault program  ⏳ in progress
## Phase 2 — Notification relay  ⛔ not started
## Phase 3 — Mobile app  ⛔ not started
## Phase 4 — Tests + e2e  ⛔ not started
