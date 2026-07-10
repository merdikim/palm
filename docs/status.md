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

## Phase 1 — Vault program  ✅ complete

- 7 instructions: `create_vault`, `agent_pay`, `reclaim`, `update_policy`,
  `create_request`, `request_agent_approval`, `respond_request`.
- Escrow-PDA model proven: agent signs, vault PDA is the token authority
  (`invoke_signed`); agent can never hold custody or sweep funds.
- Built (`vault.so` 366KB) + IDL; **deployed to devnet**
  `3955LkKVs64NZTo9dGKXAoRx7wAURcKstuXZxDqoqYtW`.
- 12 host policy unit tests + **14 live devnet integration tests, all passing.**
- Client: `shared/vault.ts`.

**Structural note (minor deviation, documented):** over-threshold `agent_pay`
returns `ApprovalRequired` (transfers nothing) and the agent calls
`request_agent_approval` to create the PaymentRequest, rather than `agent_pay`
creating it as a side-effect. This avoids per-payment request-account allocation
and keeps `agent_pay` a pure execute path; the observable behavior (request
created, no funds move, owner approves, executes with policy re-checked) is
identical and is covered by E2E-5. `respond_request` handles both user-to-user
and agent-approval via optional accounts.

## Phase 2 — Notification relay  ✅ complete

- `@palm/relay` (Fastify): `/register`, `/notify`, `/health`; content-free
  pushes (`{type, id}` only) via a `Pusher` interface (Expo + mock).
- 32 tests passing incl. the payload-privacy schema test. Log-scrubbed.
- Client-initiated-ping model (documented limitation: unauthenticated in the
  prototype; a `SubscriptionSource` can call the same `dispatch` sink later).

## Phase 3 — Mobile app  ⏳ (Expo, in progress)

- React Native + Expo, 4 screens (Onboarding/Home/Agents/Requests), signing
  behind a `Signer` interface, TEE-native client. See `app/README.md`.
- Runtime-on-device not verifiable in this environment (no simulator).

## Phase 4 — Tests + e2e  ✅ complete (program + payments + privacy + scenarios)

- **Unit:** 12 policy branch tests (`npm run test:unit`).
- **Program integration (devnet):** 14 tests (`npm run test:program`).
- **Privacy (devnet TEE):** foreign-read blocking proven (`npm run test:privacy`).
- **E2E scenarios, all passing (devnet):**
  - E2E-1 deposit→private transfer→withdraw (`npm run e2e:1`)
  - E2E-2 vault lifecycle: create→pay→see spent→reclaim→next-pay-fails (`e2e:2`)
  - E2E-3 swap-then-send (mock) + atomic slippage failure (`e2e:3`)
  - E2E-4 request + content-free relay push + accept (`e2e:4`)
  - E2E-5 over-threshold approval flow (`e2e:5`)
  - E2E-6 escape hatch: withdraw + reclaim recover funds to base (`e2e:6`)
- **Relay:** 32 tests incl. no-financial-data schema test.

## Open / next for a human to decide

1. **PER delegation of the vault to the TEE** (members `{owner, agent}`,
   `set_privacy(true)`) so agents can't see each other's vaults *at the RPC
   level*. The gating MECHANISM is proven (privacy tests, carol blocked); wiring
   the access-control CPIs into `create_vault` and running `agent_pay` on the ER
   is the remaining integration. Until then vault *state* is public on base (the
   escrow security — who can move funds — is fully enforced regardless).
2. **Swap** is mocked on devnet (no DEX liquidity); confirm live `/v1/swap` for a
   mainnet build.
3. **App on-device** runtime pass (needs a simulator/device).
