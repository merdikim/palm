# Palm — mobile app

React Native + Expo (SDK 56, RN 0.85, React 19, TypeScript), **Android only**.
Wired to the MagicBlock Private Payments API, the TEE-backed ephemeral rollup, and
the `vault` program.

> [!WARNING]
> **This app runs on MAINNET and moves real Circle USDC.** Every flow — deposit,
> private send, withdraw, payment link — settles with live funds. There is no
> devnet build.
>
> **The vault program is not deployed to mainnet**, so the **Agents** tab will fail
> until it is and `VAULT_PROGRAM_ID` in [src/lib/constants.ts](src/lib/constants.ts)
> is updated. Everything else works.

## Run

```bash
npm install
npm run android      # dev client on a device/emulator
npm run typecheck    # tsc --noEmit
npm run export:android
```

You need a real device with an **MWA-compatible wallet** (Palm has no key of its
own), holding mainnet **USDC** to deposit and a little **SOL** for fees. Each
payment link carries ~0.003 SOL so its recipient can claim without a funded wallet
— that comes out of the sender's SOL.

Build variants come from `APP_ENV` / the EAS build profile and each get their own
package id and deep-link scheme, so they coexist on one device without cross-wiring
links ([app.config.js](app.config.js)):

| Profile | Name | Package | Scheme |
|---|---|---|---|
| `development` | Palm (Dev) | `io.usepalm.app.dev` | `palmdev://` |
| `preview` | Palm (Preview) | `io.usepalm.app.preview` | `palmpreview://` |
| `production` | Palm | `io.usepalm.app` | `palm://` |

The notification relay defaults to `http://localhost:8787` (`RELAY_BASE_URL`,
overridable at runtime via `setRelayBaseUrl`). Run it from `../backend` to
exercise push registration.

## Structure

Two screens. An onboarding flow, and one signed-in shell that owns its own header,
tabs, and bottom sheets — so there's no navigator.

```
index.ts               entry — polyfills FIRST, then registerRootComponent
polyfills.ts           Buffer + crypto.getRandomValues (must load before web3.js)
App.tsx                providers, fonts, and the onboarding gate
app.config.js          dynamic Expo config (per-env name/package/scheme)
src/
  screens/
    OnboardingScreen   connect wallet -> sign to unlock -> optional first deposit
    PalmShell          Home / Agents / Links tabs + every action sheet
  components/          palm.tsx (design-system primitives), icons.tsx
  context/
    WalletContext      MWA session, Signer, onboarding step, serialized signing
    ClusterContext     the active cluster (mainnet + TEE endpoints)
  hooks/useSolanaData  react-query: balance, vaults, links, activity
  lib/
    constants.ts       MAINNET endpoints, USDC mint, program ids
    signer.ts          the Signer interface (MWA-backed)
    session.ts         TEE /auth JWT cache (expiry-aware)
    apiSession.ts      Payments API token cache (SEPARATE issuer)
    tee.ts             TEE auth, private balance read, ER submit
    payments.ts        hosted API client + signAndSend (base | ephemeral)
    chain.ts           base-layer tx submit via the Signer
    connections.ts     base + tokened TEE connections
    claimlink.ts       create / parse / claim shareable payment links
    vault.ts           PDA + ATA derivations, ix builders, account decoders
    policy.ts          tiered policy presets + summaries
    swap.ts            SwapProvider + MockSwapProvider
    registry.ts        local vault + link registries (secure-store)
    activity.ts        local append-only activity feed
    onboarding.ts      persisted onboarding step
    relay.ts           expo push token + register/notify
    borsh.ts           minimal borsh reader/writer
```

## Key decisions

**Signing goes through `Signer`, backed by Mobile Wallet Adapter.** Palm never
holds the user's private key. MWA permits only **one live association at a time** —
a second `transact()` opened while the first is alive kills it — and callers do
legitimately sign concurrently (`privateTransfer` fetches two tokens in parallel,
both possibly cold). So every sign is funnelled through a single promise chain in
[WalletContext.tsx](src/context/WalletContext.tsx). Signed messages are also
verified locally against the connected account before use, which turns an opaque
server 403 into a precise error when a wallet signs wrapped bytes.

**Two auth domains, not interchangeable.** The TEE RPC's `/auth` JWT
([session.ts](src/lib/session.ts)) authenticates private reads and ER submits. The
Payments API's `/v1/spl/login` token ([apiSession.ts](src/lib/apiSession.ts))
authenticates `/v1/spl/*` build requests. Different issuers. Unlock only fetches
the TEE token, so it costs **one** wallet prompt; the API token is acquired lazily
on the first payment, where a prompt is expected anyway.

**TEE-native balance path.** The hosted `private-balance` endpoint is neither
TEE-bound nor per-wallet private (spikes S2), so: transactions are **built** by the
Payments API with `validator = TEE`, but balances are **read** and ER transactions
**submitted** directly against the TEE RPC with `?token=`. Balance comes from the
canonical ATA (Ephemeral SPL "Model A"). Before trusting an ER read we check the
account is actually **delegated** — the TEE clones the *public* base balance for
accounts it hasn't seen, so a wallet that skipped its first deposit would otherwise
show its public USDC as a private balance.

**No Anchor at runtime.** Vault instructions are raw `TransactionInstruction`s and
accounts are decoded with a small hand-rolled Borsh layer against the deployed
program's discriminators (`src/idl/vault.json`). Keeps the Metro bundle small and
avoids Anchor's node-builtin friction in RN. PDA/ATA derivations still use
web3.js + spl-token.

**Payment links.** You cannot privately transfer to an address that has never used
the app (the recipient's ATA must already be delegated). A claim link routes around
that: a throwaway keypair is funded from the sender's shielded balance via one
`ephemeral -> base` transfer, and the secret is handed over in the URL **fragment**
(never transmitted to a server). The link account pays its own claim fee and the
recipient's ATA rent, so the recipient signs nothing and needs no SOL. Claims sweep
the ATA's *actual* balance, so a tampered link can't overstate itself. Link secrets
are persisted **before** the share sheet opens — the secret is the only key to the
funds, and the sender must be able to reclaim.

## Flows: real vs blocked

| Flow | Status | Notes |
|------|--------|-------|
| Connect wallet (MWA) | **Real** | mainnet chain, serialized associations |
| TEE `/auth` login + JWT cache | **Real** | one signature to unlock |
| Private balance read | **Real** | TEE canonical ATA, delegation-checked |
| Deposit (base → rollup) | **Real** | Payments API build + sign + submit |
| Withdraw (rollup → base) | **Real** | slower by design; user is told so |
| Private transfer (rollup → rollup) | **Real** | surfaces `RecipientNotOnboardedError` when the recipient never onboarded |
| Create / share / claim payment link | **Real** | incl. cold-start + warm deep links |
| Reclaim an unclaimed link | **Real** | sweep + re-shield; `ReclaimReshieldError` if only the re-shield leg fails (funds still safe, just public) |
| Activity feed | **Real (local)** | the rollup has no user-facing index; convenience log only |
| Create vault / top up / edit policy / revoke | **Blocked** | program not deployed to mainnet — the ix builders are correct, the address isn't live |
| Vault top-up | **Best-effort** (when unblocked) | needs the vault ATA onboarded + delegated on the ER |
| `agent_pay` swap leg | **Stubbed** | `MockSwapProvider` preserves atomic-failure semantics; live `/v1/swap` drops in behind `SwapProvider` |
| Agent-side `agent_pay` / approvals | **Builders only** | signed by the *agent* automation, not this app; exported from `src/lib/vault.ts`, no UI |
| Push register + notify | **Real (best-effort)** | needs a device + EAS `projectId`; degrades gracefully |

## Secrets

No hardcoded secrets. The user's key lives in their wallet app, not in Palm. Agent
keypairs are generated on device and shown **once**, for the user to copy into their
automation. Claim-link secrets and the two session tokens live in
`expo-secure-store`. The relay only ever sees a content-free `{ type, id }`.
