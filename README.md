# Palm — Private Payments on Solana (MagicBlock PER)

Private payments on Solana using MagicBlock **Private Ephemeral Rollups (PER)**:
your balance and activity are shielded inside a TEE-backed rollup, you can send
money as a **shareable link** to someone who has no wallet yet, and you can give
**AI/automation agents** a bounded, revocable allowance to spend on your behalf —
without the agent ever holding custody.

> [!WARNING]
> **The mobile app now points at MAINNET and moves real Circle USDC.** The rest of
> the repo (program tests, spikes, privacy tests, e2e scenarios) is still devnet.
> See [Network status](#network-status) — the two halves are **not** in sync, and
> one feature is currently broken as a result.

## Network status

| Piece | Network | Notes |
|---|---|---|
| `app/` | **Mainnet** | Real endpoints, real funds. Circle USDC `EPjFW…Dt1v`, TEE `mainnet-tee.magicblock.app`, Payments API `cluster=mainnet-private`. |
| `programs/vault/` | **Devnet only** | Deployed at `3955LkKVs64NZTo9dGKXAoRx7wAURcKstuXZxDqoqYtW`. **This program does not exist on mainnet** (verified: `getAccountInfo` → `null`). |
| `shared/`, `e2e/` | Devnet | Spikes, program tests, privacy tests, and the 6 e2e scenarios all run against devnet. |
| `backend/` (relay) | n/a | Content-free push relay; defaults to `http://localhost:8787`. |

**The consequence:** the app's **Agents** tab (create vault / top up / edit policy /
revoke) calls the vault program at its devnet address while connected to mainnet,
so those flows **will fail** until the program is deployed to mainnet and
`VAULT_PROGRAM_ID` in [app/src/lib/constants.ts](app/src/lib/constants.ts) is
updated. Everything else in the app — deposit, private send, withdraw, payment
links — is fully live on mainnet. This is called out in the source at
[constants.ts:57-60](app/src/lib/constants.ts#L57-L60).

## What's here

| Path | What | Status |
|------|------|--------|
| `app/` | React Native + Expo mobile app (Android) — the product | Mainnet; onboarding + main shell built, agents blocked on the program deploy |
| `programs/vault/` | Anchor program: per-agent escrow vaults + payment requests | Built, deployed to **devnet**; 12 unit + 14 live integration tests pass |
| `backend/` | Content-free notification relay (`@palm/relay`) | 32 tests pass |
| `shared/` | Node TS client (payments, TEE, vault, swap) used by the tests | Devnet |
| `e2e/` | Spikes, program tests, privacy tests, 6 E2E scenarios | All pass on devnet |
| `docs/` | `architecture.md`, `spikes.md`, `PRIVACY.md`, `status.md` | Written pre-mainnet; treat network details as devnet-era |

## The idea

The user's private balance is managed entirely by MagicBlock's hosted **Private
Payments API** on the **TEE validator** (`MTEWGuqx…3n3xzo`) — we write no code that
custodies it. On top of that, Palm adds three things:

**1. A private balance.** Deposit USDC and it's shielded inside the TEE rollup.
Reads are gated at the RPC ingress: a third party holding its own valid token
cannot read your private account (it gets `null` back — proven live, see
[docs/spikes.md](docs/spikes.md)).

**2. Payment links.** A private ER→ER transfer requires the recipient's account to
already be delegated, so you can't privately pay someone who has never used the
app. A **claim link** sidesteps that: the sender mints a throwaway keypair, moves
USDC from their shielded balance onto it, and shares a `palm://claim#…` URL
carrying the secret. Whoever opens it sweeps the funds into their own wallet — no
address exchanged, no wallet needed beforehand, and the link account pays its own
fees and the recipient's rent, so claiming costs the recipient nothing. The
amount and memo ride in the URL **fragment**, which never reaches a server.
Unclaimed links stay yours and can be reclaimed. See
[app/src/lib/claimlink.ts](app/src/lib/claimlink.ts).

**3. Agent vaults.** A vault is a program PDA whose private USDC balance *is* an
agent's spending allowance. The agent **signs** `agent_pay`, but funds move under
the **vault PDA's** authority straight to the merchant — the agent directs, never
holds, and can never sweep the vault. Policy (per-tx cap, daily limit, merchant
allowlist, approval threshold, expiry) is enforced on-chain; over-threshold
payments create a request the owner must approve. Revoking pulls every remaining
dollar back instantly.

A **relay** pushes only content-free "you have activity" signals — never amounts,
never counterparties. All real data is read from the rollup by the client with its
own token. See [docs/architecture.md](docs/architecture.md).

## The app

Android, React Native + Expo (SDK 56, RN 0.85, React 19). Two screens: an
onboarding flow and a single signed-in shell.

**Onboarding** ([OnboardingScreen.tsx](app/src/screens/OnboardingScreen.tsx)) —
connect an external wallet via **Mobile Wallet Adapter** → one signature to
authenticate against the TEE (`/auth` → JWT) → an optional first deposit (25% /
50% / 100% / custom of your public USDC balance), which delegates and shields it.
Progress is persisted, so a killed app resumes where it left off.

**The shell** ([PalmShell.tsx](app/src/screens/PalmShell.tsx)) — three tabs plus
bottom-sheet flows:

- **Home** — the shielded balance (tap the lock to mask every figure on screen),
  and *Add* / *Send* / *Withdraw* / *Send link*, over a local activity feed.
- **Agents** — per-agent vaults with spend-vs-budget progress and policy chips;
  create (the agent's secret key is shown once, to wire into your automation),
  top up, edit policy, or revoke. *Blocked on mainnet — see above.*
- **Links** — outgoing payment links, open vs claimed, with re-share and reclaim.
  Incoming `palm://claim#…` deep links open a claim sheet, on cold start or while
  running.

Notable implementation points:

- **No agent keys, no user keys.** Signing goes through a `Signer` interface backed
  by Mobile Wallet Adapter; Palm never holds the user's private key. MWA allows
  only one live association, so all signing is funnelled through a serialized queue
  ([WalletContext.tsx:38-54](app/src/context/WalletContext.tsx#L38-L54)).
- **Two separate auth domains.** The TEE RPC's `/auth` JWT
  ([session.ts](app/src/lib/session.ts)) and the Payments API's `/v1/spl/login`
  token ([apiSession.ts](app/src/lib/apiSession.ts)) are different issuers and are
  **not** interchangeable. Both are cached in `expo-secure-store` with
  expiry-aware refresh; the API token is fetched lazily so unlocking costs one
  wallet prompt, not two.
- **No Anchor at runtime.** Vault instructions are raw `TransactionInstruction`s
  with a hand-rolled Borsh layer against the deployed IDL's discriminators, keeping
  the Metro bundle small.
- **Data via react-query.** Balance, vaults, links, and activity are queries
  invalidated after each action ([useSolanaData.ts](app/src/hooks/useSolanaData.ts)).
- **Local hints, chain as truth.** Vault and link registries live in secure storage
  because a thin client can't cheaply enumerate its own vault PDAs, and a link's
  secret is the only key to its funds. The chain is always the source of truth.

## Run it

### The app (mainnet — real money)

```bash
cd app && npm install
npm run android      # dev client on a connected device/emulator
npm run typecheck
```

You need a real Android device with an MWA-compatible wallet installed, that
wallet funded with **mainnet USDC** (to deposit) and a little **SOL** (fees, plus
~0.003 SOL per payment link, which the link carries so the recipient can claim for
free). Build variants (`development` / `preview` / `production`) each get their own
package id and deep-link scheme (`palmdev` / `palmpreview` / `palm`) so they can
coexist on one device without cross-wiring links — see
[app/app.config.js](app/app.config.js).

### The devnet test suite

Prerequisites: Node 24, Rust + Solana CLI + Anchor 0.32.1. Test keypairs live in
`keys/` (gitignored) and are funded on devnet; the test mint is recorded in
`shared/deployment.json`.

```bash
npm install
npm run setup:mint       # one-time: create + initialize the test mint on the TEE

npm run spike:s2         # full private deposit/transfer/withdraw loop on the TEE
npm run spike:s5         # swap availability probe (devnet: no route -> mock)

npm run test:unit        # 12 policy unit tests (cargo)
npm run test:program     # 14 live devnet integration tests
npm run test:privacy     # foreign-read blocking, proven live

npm run e2e:1  # deposit -> private transfer -> withdraw
npm run e2e:2  # vault: create -> agent pays -> see spent -> reclaim -> next-pay-fails
npm run e2e:3  # swap-then-send (mock) + atomic slippage failure
npm run e2e:4  # request + content-free relay push + accept
npm run e2e:5  # over-threshold approval flow
npm run e2e:6  # escape hatch: recover funds to base

cd backend && npm test   # 32 relay tests incl. the no-financial-data schema test
```

## Privacy posture

See [docs/PRIVACY.md](docs/PRIVACY.md). In short: the relay learns nothing
financial (event type + opaque id only), the hosted API only builds unsigned
transactions, and the TEE RPC enforces per-wallet read gating at ingress. Claim
link secrets and memos travel in the URL fragment and never reach a server.

## Known gaps

- **The vault program isn't on mainnet**, so the app's agents feature is dead until
  it is deployed and the program id updated. This is the one blocking item.
- **Vault state is public on base.** PER delegation of the vault to the TEE (so
  agents can't see each other's vaults *at the RPC level*) is scoped but not wired
  — the gating mechanism is proven, the `create_vault` access-control CPIs are not.
  The escrow *security* (who can move funds) is fully enforced regardless.
- **The swap leg is mocked** (`SwapProvider` / `MockSwapProvider`, atomic-failure
  semantics preserved); devnet had no DEX route. A live `/v1/swap` drops in behind
  the same interface.
- **Vault top-up is best-effort** — it depends on the vault ATA being onboarded and
  delegated on the rollup.
- **The relay is unauthenticated** in this prototype (client-initiated ping model),
  and defaults to `localhost:8787`.
- **The docs in `docs/` predate the mainnet move** and describe devnet endpoints.
- Deposit/withdraw still leak base-layer timing; the anonymity set is small; the
  daily-limit window is a coarse 24h reset; agent↔merchant collusion is out of
  scope.
