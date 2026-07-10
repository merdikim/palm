# Architecture — Private Payments on Solana (MagicBlock PER)

> Devnet-only prototype. Every decision here traces back to the build spec and
> the Phase 0 spike findings in [spikes.md](./spikes.md). If a spike invalidates
> something here, the change is recorded in both files, never silently.

## 1. The one-paragraph shape

A user's private balance lives inside a **TEE-backed ephemeral rollup (PER)** on
the MagicBlock devnet TEE validator (`MTEWGuqx…3n3xzo`). The user's *own* money
is managed entirely by MagicBlock's hosted **Private Payments API** — we write no
code that custodies it. On top of that we add exactly one small Anchor program:
**per-agent escrow vaults**. Each vault is a program-owned PDA whose private token
balance *is* an AI/automation agent's spending allowance. The agent can *direct*
payments out of its vault to merchants but can never hold custody. A shared
**PaymentRequest** primitive (created directly on the ER) handles both
user-to-user "request to pay" and agent over-threshold approvals. A **notification
relay** pushes content-free "you have activity" signals; all real data is read
from the ER by the client with its own bearer token.

## 2. Trust & privacy boundary

```
        ┌──────────────────────── the user's device ────────────────────────┐
        │  keypair (secure storage)  ·  bearer token  ·  all cleartext data  │
        └───────────────┬───────────────────────────────────┬───────────────┘
                        │ signs txs                          │ reads private state
                        ▼                                    ▼
   ┌─────────────────────────────┐            ┌──────────────────────────────────┐
   │  Private Payments API        │            │  MagicBlock devnet TEE validator │
   │  (builds unsigned txs only,  │            │  (PER — enforces permission      │
   │   never signs, never stores) │───────────▶│   membership at ingress)         │
   └─────────────────────────────┘            └──────────────────────────────────┘
                        │                                    ▲
                        │ delegate / undelegate              │ agent_pay, requests,
                        ▼                                    │ policy checks (our program)
   ┌─────────────────────────────────────────────────────────────────────────────┐
   │  Solana devnet (base layer)  —  vault PDAs, delegation records, USDC vault    │
   └─────────────────────────────────────────────────────────────────────────────┘
                        ▲
                        │ content-free push ("new_request", opaque id)
   ┌─────────────────────────────┐
   │  Notification relay          │  ← learns NOTHING financial. See PRIVACY.md
   └─────────────────────────────┘
```

**Who can see what**

| Actor                    | Can see                                                            | Cannot see |
|--------------------------|-------------------------------------------------------------------|------------|
| Owner (user)             | Own private balance, own vaults, requests they are a member of    | Other users' balances/vaults |
| Agent                    | Only *its own* vault (it is a permission member of that vault)     | Owner's main balance, other agents' vaults, other users |
| Third party (no membership) | Nothing — blocked at ER ingress by the permission program        | Everything private |
| Notification relay       | Device push tokens keyed by wallet; event *type* + opaque id      | Amounts, counterparties, memos, balances, request contents |
| Payments API server      | Transaction contents it is asked to *build* (transient, unsigned) | It never signs or persists; private reads need the caller's token |

## 3. Core design decisions (fixed) and their spike status

| # | Decision | Spike | Status |
|---|----------|-------|--------|
| D1 | No profile PDA / no smart-wallet layer. User's own balance = hosted API only. | S2 | ✅ API reachable on devnet |
| D2 | No Solana Subscriptions program. Agent spend = our vault program. | — | Design |
| D3 | One vault PDA per `(owner, agent)`, seeds `["vault", owner, agent]`. Vault's private balance = the allowance. | S3 | ✅ escrow-PDA pattern viable (Model A) |
| D4 | Agent is director, never custodian: `agent_pay` moves vault→merchant, PDA signs via seeds, agent is only the tx signer. | S3 | ✅ standard SPL escrow CPI |
| D5 | Swap-then-send built into `agent_pay`; caps enforced on the USDC debit side. | S5 | ⚠️ swap-from-PDA is the hard leg — see §5 |
| D6 | Tiered vault policy (tx cap+slippage / daily / allowlist+threshold+expiry). | — | Program |
| D7 | `PaymentRequest` PDA created directly on the ER, members `{requester, payer}`. | S4 | ⚠️ enumeration path TBD |
| D8 | Relay learns nothing — content-free pushes only. | — | Backend |

## 4. The escrow model (D3/D4) — how the agent moves money it can't hold

The vault is a program PDA. Its **USDC token account** (a canonical ATA owned by
the vault PDA) is delegated to the TEE ER. On the ER the balance materializes as a
normal SPL token account (Ephemeral SPL Token "Model A"). `agent_pay` is an ER
instruction where:

- **signer / fee payer** = the agent keypair (must equal `vault.agent`);
- **token authority** = the vault PDA, which signs the SPL `transfer` CPI via its
  program seeds (`invoke_signed`).

So the agent authorizes *that a payment happens*, but the funds move under the
program's authority, straight from vault → merchant ATA. The agent never becomes
the token authority, so it can never sweep funds to itself. Policy checks and the
debit are in the **same instruction** — no check-then-act gap.

Hard anti-self-payment rule: `agent_pay` rejects `merchant == vault.agent` unless
the agent is explicitly on a configured `merchant_allowlist`. Residual risk: an
agent colluding with a merchant it controls (a merchant address that is not its
own signer) is out of scope — the allowlist / caps / approval threshold are the
mitigations, documented as an accepted limitation.

## 5. The swap leg (D5) — the genuinely hard part

`agent_pay(merchant, mint_out, amount_out)` denominates all policy in USDC. If
`mint_out == USDC`, it is a pure escrow transfer (fully supported, §4). If
`mint_out != USDC` a swap is required, and the source of funds is a **PDA**, not a
user keypair. The hosted `/v1/swap/swap` flow signs with a real `userPublicKey`
and schedules a private transfer via a Hydra crank — it is not built to have a
program PDA as the swap authority. See [spikes.md](./spikes.md) S5 for the tested
outcome and the chosen path. The design keeps swap behind a `SwapProvider`
interface with **atomic-failure semantics**: either USDC-debit + swap + deliver
all succeed, or nothing moves. When devnet swap-from-PDA is unavailable, the
provider is a deterministic mock that preserves those semantics so every other
branch (caps, slippage bound, atomic rollback) is still exercised end to end.

## 6. Program surface (`programs/vault`)

`create_vault` · `agent_pay` · `reclaim` · `update_policy` · `create_request` ·
`respond_request`. Full account layouts and per-instruction invariants live next
to the code and are mirrored as tests. See §3 of the build spec; deviations, if
any, are logged in [status.md](./status.md).

## 7. Endpoints (all devnet) — single source of truth is `shared/constants.ts`

- Base layer: `api.devnet.solana.com` / `rpc.magicblock.app/devnet`
- Router: `devnet-router.magicblock.app`
- Private ER (TEE): `devnet-tee.magicblock.app`, validator `MTEWGuqx…3n3xzo`
- Payments API: `payments.magicblock.app` with `cluster=devnet`
- Devnet USDC: `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` (6 decimals)

## 8. Accepted limitations (do not try to solve)

Deposit/withdraw base-layer timing correlation · TEE trust assumptions · small
anonymity set · coarse 24h daily-window reset · manual vault top-ups (no
auto-recurring allowance) · agent↔merchant collusion (see §4).
