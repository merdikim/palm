# Palm — private-payments mobile prototype

React Native + Expo (managed, TypeScript) client for the private-payments
product. Devnet only. Wired to the real MagicBlock Private Payments API, the
TEE-backed ephemeral rollup, and the deployed `vault` program.

> This is a test build, not a design exercise. UI is plain and dark-friendly.

## Run

```bash
cd app
npm install
npx expo start          # then press i (iOS), a (Android), or w (web)
```

Other scripts:

```bash
npm run typecheck       # tsc --noEmit  (passes clean)
npm run export:web      # metro web bundle
npm run export:ios      # metro iOS (Hermes) bundle
```

You need a device or simulator to actually run flows. On device, allow
notifications for push deep-linking. Get devnet SOL for your generated key
(fees/rent) via a faucet or `requestAirdrop` (exposed in `src/lib/chain.ts`).

### Relay

The notification relay base URL defaults to `http://localhost:8787`
(`RELAY_BASE_URL` in `src/lib/constants.ts`, overridable at runtime via
`setRelayBaseUrl`). Run the relay from `../backend` to exercise push
registration/notify.

## Architecture / contracts

Context read first: `../docs/architecture.md`, `../docs/spikes.md`. The client
contracts are ported from `../shared/{payments,tee,vault}.ts` and adapted for
RN (no `node:*`; JSON bundled via import; `fetch`; web3.js with polyfills).

### The signing interface

All signing goes through `Signer` (`src/lib/signer.ts`):

```ts
interface Signer {
  publicKey: PublicKey;
  signMessage(bytes): Promise<Uint8Array>;
  signTransaction(tx): Promise<tx>;
}
```

The only implementation today is `LocalKeypairSigner` — a locally-generated
ed25519 keypair whose secret key lives in `expo-secure-store`. Nothing else in
the app assumes a raw keypair, so a Mobile Wallet Adapter session or an
embedded/MPC wallet can be dropped in behind this interface without touching
call sites.

### Polyfills (entry order matters)

`index.ts` imports, before anything else:

1. `react-native-get-random-values` — `crypto.getRandomValues` for
   tweetnacl / `Keypair.generate`.
2. `buffer` — assigns `global.Buffer` for web3.js / spl-token / our borsh layer.

### Anchor decision

We do **not** use the `@coral-xyz/anchor` runtime on device. The vault
instructions are built as raw `TransactionInstruction`s and account data is
decoded with a small hand-rolled Borsh layer (`src/lib/borsh.ts`,
`src/lib/vault.ts`) against the deployed program's known discriminators (bundled
`src/idl/vault.json`). This keeps the Metro bundle small and deterministic and
avoids anchor's node-builtin / dynamic-require friction in RN. PDA and ATA
derivations reuse `@solana/web3.js` + `@solana/spl-token`.

### TEE-native user balance (spikes S2)

The hosted `private-balance` endpoint is neither TEE-bound nor per-wallet
private, so the user-balance path is TEE-native:

- deposit/withdraw/transfer txs are **built** by the Payments API with
  `validator = TEE`;
- auth is the **TEE RPC's own** `/auth` JWT (`src/lib/tee.ts` + `session.ts`,
  expiry-aware refresh);
- balances are **read** and ER txs are **submitted** directly against the TEE
  RPC with `?token=` (`src/lib/connections.ts`), re-stamping the ER blockhash
  before signing, and always checking `confirmTransaction().value.err`.

Balance is read from the **canonical ATA** amount (Ephemeral SPL "Model A").

## Flows: real vs stubbed

| Flow | Status | Notes |
|------|--------|-------|
| Create/import local key, secure-store persistence | **Real** | `LocalKeypairSigner` |
| TEE `/auth` login + expiry-aware JWT cache | **Real** | `tee.ts`, `session.ts` |
| Private balance read (TEE canonical ATA) | **Real** | `readTeeBalance` |
| Deposit (base → rollup) | **Real** | Payments API build + sign + submit |
| Withdraw (rollup → base, "slower ~") | **Real** | Payments API build + sign + submit |
| Private transfer (rollup → rollup) | **Real** | Payments API, ephemeral submit w/ token; surfaces `RecipientNotOnboardedError` on `InvalidWritableAccount` (S2#7) |
| Create vault (owner-signed) | **Real** | base-layer program ix |
| Update policy / revoke (reclaim+close) | **Real** | base-layer program ix |
| Vault top-up | **Best-effort** | private transfer to the vault PDA; depends on the vault ATA being onboarded/delegated on the ER |
| Create request / respond (accept/deny) | **Real** | ER-native program ix, deterministic counter derivation (S4) |
| Request discovery | **Real (derivation) + local hints** | scans payer counter + secure-store registry |
| Push register + notify | **Real (best-effort)** | needs a real device + a configured EAS `projectId`; degrades gracefully off-device |
| `agent_pay` swap leg | **Stubbed** | no devnet DEX route (S5); behind `SwapProvider`, `MockSwapProvider` preserves atomic-failure semantics |
| Agent-side `agent_pay` / `request_agent_approval` | **Builders only** | these are signed by the *agent* automation, not this user app; instruction builders are exported in `src/lib/vault.ts` but not wired to a UI |

## Layout

```
app/
  index.ts            entry — polyfills first, registerRootComponent
  App.tsx             providers + navigation + push deep-link wiring
  app.json            expo config (scheme "palm", secure-store + notifications plugins)
  src/
    idl/vault.json    bundled program IDL (copied from shared/)
    deployment.json   copied from shared/
    theme.ts
    lib/
      constants.ts    devnet endpoints/mints/program id (copied from shared/)
      borsh.ts        minimal borsh reader/writer
      signer.ts       Signer interface + LocalKeypairSigner
      connections.ts  base + tokened TEE connections
      payments.ts     hosted API client + signAndSend (base/ephemeral)
      tee.ts          TEE /auth, readTeeBalance, submitTeeTx(Object)
      session.ts      expiry-aware TEE JWT cache
      vault.ts        PDA/ATA derivations, ix builders, account decoders
      policy.ts       tiered policy presets + summaries
      swap.ts         SwapProvider + MockSwapProvider
      chain.ts        base-layer tx submit via Signer
      relay.ts        expo push token + register/notify
      registry.ts     local vault + request registries (secure-store)
      onboarding.ts   persisted onboarding step + memo hashing
      actions.ts      high-level flows the screens call
      format.ts       usd/pubkey formatting
    context/WalletContext.tsx
    navigation/types.ts   param lists + deep-link config
    screens/          Onboarding, Home, AgentsList, CreateVault, AgentDetail, Requests
    components/ui.tsx
```

## Constraints

Devnet only. No mainnet endpoints. No hardcoded secrets (the wallet key is
generated on device and stored in the OS secure store; agent keys generated in
the Create-vault screen are shown once for the user to copy). The notification
relay learns nothing financial — payloads are content-free `{ type, id }`.
