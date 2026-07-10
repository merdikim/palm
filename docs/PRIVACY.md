# PRIVACY.md — what each component can and cannot see

This is derived from the implementation, not aspiration. Where a claim is
enforced by a mechanism we verified live, it says so.

## The notification relay (`backend/`)

**Can see:**
- A mapping of **wallet pubkey → device push token(s)**, so it can route pushes.
- **Event *type*** only: one of `new_request`, `request_responded`,
  `agent_payment`, `approval_needed`.
- An **opaque id** (e.g. a request/vault pubkey or a random correlation id) used
  purely for client-side deep-linking.

**Cannot see:**
- Amounts, mints, prices, or slippage.
- Counterparties (who paid whom, which merchant, which agent).
- Memos or any request contents.
- Any balance — it never holds a TEE token and never reads the ER.

**How this is guaranteed:**
- The push payload schema is fixed to `{type, id}` and enforced by a schema test
  (`backend` tests). Anything richer fails the test.
- The relay has no database of financial data — only the token registry.
- Logs are scrubbed: the relay never logs anything beyond event type + id.
- The relay learns of events either from a service-token ER subscription that
  sees only *that an account it watches changed* (not readable contents, if the
  subscription is content-blind) or from client-initiated content-free pings. It
  never receives cleartext financial data from the client.

## The hosted Private Payments API (MagicBlock)

**Can see:** the contents of a transaction it is asked to *build* (transiently,
to construct the unsigned tx). It never signs, never submits, and does not
persist financial data.

**Important, verified caveat:** the hosted **`private-balance` REST endpoint is
NOT per-wallet private** — with any valid token it will return any address's
balance. We therefore **never** use it for private reads. All private reads go
directly to the TEE ER RPC, which *does* enforce per-wallet gating (below).

## The TEE ER RPC (the privacy boundary)

**Enforced at ingress by the query-filtering service (verified live):**
- A wallet authenticates via the ER's `/auth` flow and gets a JWT.
- With its token, it can read **only its own** private accounts (and accounts it
  is a permission member of).
- **A third party with its own valid token reading someone else's private
  account gets `value: null`.** Confirmed: a non-member wallet could not read
  another user's private balance.

## The user's device (`app/`)

Holds the keypair (secure storage), the TEE bearer token, and therefore all
cleartext the user is entitled to. This is the only place private data is
assembled in the clear.

## Accepted, out-of-scope limitations (prototype)

Deposit/withdraw base-layer timing correlation · TEE hardware trust assumptions ·
small anonymity set · agent↔merchant collusion via a merchant the agent controls
but does not sign for. These are documented in `architecture.md §8` and not
addressed here.
