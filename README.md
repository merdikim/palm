# Palm — Private Payments on Solana (MagicBlock PER)

A devnet prototype for **private payments** on Solana using MagicBlock **Private
Ephemeral Rollups (PER)**, where a user's balance and activity are shielded
inside a TEE-backed rollup, and where the user can authorize **AI/automation
agents** to pay merchants from **bounded, revocable escrow vaults** — without the
agents ever holding custody.

> **Devnet only.** No mainnet endpoints or real funds anywhere in this repo.

## What's here

| Path | What | Status |
|------|------|--------|
| `programs/vault/` | Anchor program: per-agent escrow vaults + payment requests | ✅ built, **deployed to devnet**, 14 live tests pass |
| `backend/` | Content-free notification relay (`@palm/relay`) | ✅ 32 tests pass |
| `app/` | React Native + Expo mobile app (4 screens) | ⏳ built; on-device run pending |
| `shared/` | TS client: payments API, TEE-native auth/read/submit, vault, swap | ✅ |
| `e2e/` | Spikes, program tests, privacy tests, E2E scenarios | ✅ all pass on devnet |
| `docs/` | `architecture.md`, `spikes.md`, `PRIVACY.md`, `status.md` | ✅ |

Deployed vault program: **`3955LkKVs64NZTo9dGKXAoRx7wAURcKstuXZxDqoqYtW`** (devnet).

## The idea in one paragraph

The user's own private balance is managed entirely by MagicBlock's hosted
**Private Payments API** on the **TEE validator** (`MTEWGuqx…3n3xzo`) — we write
no code that custodies it. On top we add one small Anchor program: **per-agent
escrow vaults**. A vault is a program PDA whose private USDC balance *is* an
agent's spending allowance. The agent **signs** `agent_pay`, but funds move under
the **vault PDA's** authority straight to a merchant — the agent directs, never
holds. A shared **PaymentRequest** primitive handles user-to-user requests and
agent over-threshold approvals. A **relay** pushes only content-free "you have
activity" signals; all real data is read from the ER by the client with its own
token. See [docs/architecture.md](docs/architecture.md).

## Key findings that shaped the build (Phase 0)

Full detail in [docs/spikes.md](docs/spikes.md). The load-bearing ones:

- **TEE ingress privacy is real:** a third party with its own valid token cannot
  read another wallet's private account (returns `null`). Proven live.
- **The hosted `private-balance` endpoint is *not* per-wallet private**, so all
  private reads are **TEE-native** (build via the API, read/submit against the
  TEE RPC with `?token=`).
- **Escrow-PDA works (S3):** the vault's balance moves via SPL CPI under the
  vault PDA's authority while a *different* key (the agent) is the signer.
- **No devnet swap liquidity (S5):** the swap leg is a mock behind a
  `SwapProvider` interface with atomic-failure semantics.

## Run it

Prerequisites: Node 24, Rust + Solana CLI + Anchor 0.32.1 (for building the
program). Test keypairs live in `keys/` (gitignored) and are already funded on
devnet; the test mint is recorded in `shared/deployment.json`.

```bash
npm install

# One-time: create + initialize the test mint on the TEE validator
npm run setup:mint

# Phase 0 spikes
npm run spike:s2         # full private deposit/transfer/withdraw loop on TEE
npm run spike:s5         # swap availability probe (devnet: no route -> mock)

# Program
cd programs/vault && cargo test --lib && cd ../..   # 12 policy unit tests
npm run test:program     # 14 live devnet integration tests (all branches)

# Privacy + end-to-end scenarios (devnet)
npm run test:privacy
npm run e2e:1  # deposit -> private transfer -> withdraw
npm run e2e:2  # vault: create -> agent pays -> see spent -> reclaim -> next-pay-fails
npm run e2e:3  # swap-then-send (mock) + atomic slippage failure
npm run e2e:4  # request + content-free relay push + accept
npm run e2e:5  # over-threshold approval flow
npm run e2e:6  # escape hatch: recover funds to base

# Relay
cd backend && npm test        # 32 tests incl. no-financial-data schema test

# App
cd app && npm install && npx expo start
```

## Privacy posture

See [docs/PRIVACY.md](docs/PRIVACY.md). In short: the relay learns nothing
financial (event type + opaque id only), the hosted API only builds unsigned
transactions, and the TEE RPC enforces per-wallet read gating at ingress.

## Accepted limitations (prototype)

Deposit/withdraw base-layer timing correlation · TEE trust assumptions · small
anonymity set · coarse 24h daily-window reset · manual vault top-ups ·
agent↔merchant collusion. Plus two scoped next-steps: **PER delegation of the
vault to the TEE** (vault *state* privacy at the RPC level — mechanism proven,
integration scoped in [docs/status.md](docs/status.md)) and **live swap** for a
mainnet build.
