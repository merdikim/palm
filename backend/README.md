# @palm/relay — content-free notification relay

A minimal, privacy-preserving push relay for the Palm private-payments prototype
(devnet only). It routes "you have activity" pushes to a wallet's registered
devices **without ever seeing anything financial**. It is a Fastify + TypeScript
service in the repo's npm workspace.

## Run

From this `backend/` directory (deps are installed at the workspace root or here):

```bash
npm install        # first time (can also be run at repo root)
npm run dev        # start with reload (tsx watch), listens on PORT (default 8787)
npm start          # start once
npm test           # vitest run
```

`PORT` is read from the environment (see `.env.example`, default `8787`).

## Endpoints

| Method + path     | Body                              | Purpose |
|-------------------|-----------------------------------|---------|
| `GET /health`     | —                                 | Liveness → `{ "status": "ok" }` |
| `POST /register`  | `{ wallet, pushToken }`           | Add a device push token for a wallet |
| `DELETE /register`| `{ wallet, pushToken }`           | Remove a device push token |
| `POST /notify`    | `{ targetWallet, type, id }`      | Send a content-free push to the target wallet's devices |

- `wallet` / `targetWallet`: base58 32-byte Solana pubkey (validated).
- `pushToken`: an Expo push token, e.g. `ExponentPushToken[…]` (validated).
- `type`: one of `new_request`, `request_responded`, `agent_payment`,
  `approval_needed`.
- `id`: an opaque string used only for client-side deep-linking.

Invalid `wallet`, `type`, or `pushToken` → `400`. A `/notify` for a wallet with
no registered devices is a **no-op that still returns `200`** (the relay must not
reveal whether a wallet is registered).

The push payload is built in exactly one place — `buildPushMessage(type, id)` in
`src/messages.ts` — and its `data` is always exactly `{ type, id }` with generic
per-type title/body copy.

## What this relay can / cannot see

The authoritative contract is [`../docs/PRIVACY.md`](../docs/PRIVACY.md). In short:

**Can see**
- A mapping of wallet pubkey → device push token(s) (in-memory `Map`, no DB).
- The event **type** (one of the four above).
- An **opaque id** for deep-linking.

**Cannot see** (and is structurally unable to emit)
- Amounts, mints, prices, slippage.
- Counterparties (who paid whom, which merchant, which agent).
- Memos or any request contents.
- Any balance — it never holds a TEE token and never reads the ER.

**How that is enforced here**
- The push payload schema is fixed to `{ type, id }` at the single choke point
  `buildPushMessage`, and a schema test asserts nothing richer can leak.
- The only state is the token registry — there is no financial database.
- Logs are scrubbed to `{ method, path, type, targetWalletPrefix }` where
  `targetWalletPrefix` is the first 4 chars of the wallet. Full wallets, ids,
  push tokens, and request bodies are never logged.

## Prototype limitation (by design)

Client-initiated `/notify` pings are **unauthenticated** in this prototype: any
caller can request a push for a registered wallet. The payload is content-free
regardless, so no financial data can leak, but the trigger is not authorized. A
production version would authenticate the pinging client and/or replace the ping
with a service-token ER subscription. That future `SubscriptionSource` would call
the same internal `dispatch(type, id, targetWallet)` sink, so the privacy
contract holds no matter what triggers a push. See `architecture.md §8`.

## Layout

```
src/
  index.ts       entry — buildServer(new ExpoPusher()).listen(...)
  server.ts      buildServer(pusher) Fastify app factory + dispatch()
  pusher.ts      Pusher interface + ExpoPusher (real) + MockPusher (tests)
  registry.ts    in-memory wallet → push-token registry
  messages.ts    buildPushMessage(type, id) — the payload choke point
  validation.ts  zod schemas + base58 pubkey check
test/
  messages.test.ts  schema / privacy assertions
  server.test.ts    registry, dispatch, and validation via app.inject
```
