/**
 * Typed client for the MagicBlock hosted Private Payments API.
 *
 * The API is stateless: it only *builds* unsigned transactions. This client
 * builds, the caller signs, then submits to the chain the API names in
 * `sendTo`. Private reads require a bearer token from the challenge/login flow.
 *
 * Every request here pins `cluster=devnet`. Private (PER) flows also pin the
 * TEE validator so balances land on the private, TEE-backed rollup.
 */
import nacl from "tweetnacl";
import bs58 from "bs58";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  PAYMENTS_API,
  PAYMENTS_CLUSTER,
  TEE_VALIDATOR_IDENTITY,
  TEE_ER_ENDPOINT,
  SOLANA_DEVNET_RPC,
  USDC_DEVNET,
} from "./constants.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface BuiltTx {
  kind: string;
  version: "legacy" | "v0";
  transactionBase64: string;
  sendTo: "base" | "ephemeral";
  recentBlockhash: string;
  lastValidBlockHeight: number;
  instructionCount: number;
  requiredSigners: string[];
  validator: string;
}

export type Visibility = "public" | "private";
export type BalanceLoc = "base" | "ephemeral";

export interface ApiError {
  error: { code: string; message: string; details?: unknown; issues?: unknown };
}

// ---------------------------------------------------------------------------
// Low-level fetch with clear errors
// ---------------------------------------------------------------------------
async function api<T>(
  path: string,
  init: RequestInit & { query?: Record<string, string | undefined> } = {},
): Promise<T> {
  const { query, ...rest } = init;
  let url = `${PAYMENTS_API}${path}`;
  if (query) {
    const qs = new URLSearchParams(
      Object.entries(query).filter(([, v]) => v != null) as [string, string][],
    );
    url += `?${qs.toString()}`;
  }
  const res = await fetch(url, {
    ...rest,
    headers: { "content-type": "application/json", ...(rest.headers ?? {}) },
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    const e = body as ApiError;
    const msg = e?.error?.message ?? text ?? res.statusText;
    throw new Error(`Payments API ${res.status} ${path}: ${msg}`);
  }
  return body as T;
}

// ---------------------------------------------------------------------------
// Auth: challenge -> sign -> login -> bearer token
// ---------------------------------------------------------------------------
export interface Session {
  pubkey: string;
  token: string;
  issuedAt: number;
}

export async function login(kp: Keypair): Promise<Session> {
  const pubkey = kp.publicKey.toBase58();
  const { challenge } = await api<{ challenge: string }>("/v1/spl/challenge", {
    method: "GET",
    query: { pubkey, cluster: PAYMENTS_CLUSTER },
  });
  const sig = nacl.sign.detached(
    new TextEncoder().encode(challenge),
    kp.secretKey,
  );
  const { token } = await api<{ token: string }>("/v1/spl/login", {
    method: "POST",
    body: JSON.stringify({
      pubkey,
      challenge,
      signature: bs58.encode(sig),
      cluster: PAYMENTS_CLUSTER,
    }),
  });
  return { pubkey, token, issuedAt: Date.now() };
}

// ---------------------------------------------------------------------------
// Mint setup
// ---------------------------------------------------------------------------
// validator omitted => API default (MAS1, the hosted private validator).
export function initializeMint(payer: string, mint: string, validator?: string) {
  return api<BuiltTx & { transferQueue: string; rentPda: string }>(
    "/v1/spl/initialize-mint",
    {
      method: "POST",
      body: JSON.stringify({ payer, mint, cluster: PAYMENTS_CLUSTER, ...(validator ? { validator } : {}) }),
    },
  );
}

export function isMintInitialized(mint: string, validator?: string) {
  return api<{ mint: string; validator: string; transferQueue: string; initialized: boolean }>(
    "/v1/spl/is-mint-initialized",
    { method: "GET", query: { mint, cluster: PAYMENTS_CLUSTER, validator } },
  );
}

// ---------------------------------------------------------------------------
// Deposit / withdraw / transfer
// ---------------------------------------------------------------------------
// NOTE ON VALIDATOR SELECTION (Phase 0 finding, see docs/spikes.md S2):
// The hosted read/transfer endpoints operate against the API's OWN private
// validator (MAS1...). `private-balance` ignores a `validator` override and
// always reads from MAS1. So the user-balance path omits `validator` and lives
// on MAS1 — the hosted service's query-filtering-gated private ER. The TEE
// validator (MTEW...) is reserved for our vault program's PER access-control,
// which we drive directly, not through these hosted endpoints.
export function buildDeposit(opts: {
  owner: string;
  amount: number | bigint;
  mint?: string;
  validator?: string;
}) {
  return api<BuiltTx>("/v1/spl/deposit", {
    method: "POST",
    body: JSON.stringify({
      owner: opts.owner,
      amount: Number(opts.amount),
      mint: opts.mint ?? USDC_DEVNET,
      cluster: PAYMENTS_CLUSTER,
      ...(opts.validator ? { validator: opts.validator } : {}),
      initIfMissing: true,
      initAtasIfMissing: true,
      initVaultIfMissing: true,
      idempotent: true,
    }),
  });
}

export function buildWithdraw(opts: {
  owner: string;
  amount: number | bigint;
  mint?: string;
  validator?: string;
}) {
  return api<BuiltTx>("/v1/spl/withdraw", {
    method: "POST",
    body: JSON.stringify({
      owner: opts.owner,
      amount: Number(opts.amount),
      mint: opts.mint ?? USDC_DEVNET,
      cluster: PAYMENTS_CLUSTER,
      ...(opts.validator ? { validator: opts.validator } : {}),
      initIfMissing: true,
      initAtasIfMissing: true,
      idempotent: true,
    }),
  });
}

export function buildTransfer(
  opts: {
    from: string;
    to: string;
    amount: number | bigint;
    mint?: string;
    visibility: Visibility;
    fromBalance: BalanceLoc;
    toBalance: BalanceLoc;
    validator?: string;
    memo?: string;
    minDelayMs?: string;
    maxDelayMs?: string;
    split?: number;
  },
  token?: string,
) {
  const headers: Record<string, string> = {};
  if (token) headers["authorization"] = `Bearer ${token}`;
  return api<BuiltTx>("/v1/spl/transfer", {
    method: "POST",
    headers,
    body: JSON.stringify({
      from: opts.from,
      to: opts.to,
      mint: opts.mint ?? USDC_DEVNET,
      amount: Number(opts.amount),
      visibility: opts.visibility,
      fromBalance: opts.fromBalance,
      toBalance: opts.toBalance,
      cluster: PAYMENTS_CLUSTER,
      ...(opts.validator ? { validator: opts.validator } : {}),
      initIfMissing: true,
      initAtasIfMissing: true,
      initVaultIfMissing: false,
      memo: opts.memo,
      minDelayMs: opts.minDelayMs,
      maxDelayMs: opts.maxDelayMs,
      split: opts.split,
    }),
  });
}

// ---------------------------------------------------------------------------
// Balances
// ---------------------------------------------------------------------------
export function baseBalance(address: string, mint = USDC_DEVNET) {
  return api<{ balance: string; ata: string; location: string }>(
    "/v1/spl/balance",
    { method: "GET", query: { address, mint, cluster: PAYMENTS_CLUSTER } },
  );
}

export function privateBalance(address: string, token: string, mint = USDC_DEVNET) {
  return api<{ balance: string; ata: string; location: string }>(
    "/v1/spl/private-balance",
    {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      query: { address, mint, cluster: PAYMENTS_CLUSTER },
    },
  );
}

// ---------------------------------------------------------------------------
// Swap
// ---------------------------------------------------------------------------
export function swapQuote(opts: {
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps?: number;
  swapMode?: "ExactIn" | "ExactOut";
}) {
  return api<Record<string, unknown>>("/v1/swap/quote", {
    method: "GET",
    query: {
      inputMint: opts.inputMint,
      outputMint: opts.outputMint,
      amount: opts.amount,
      slippageBps: opts.slippageBps?.toString(),
      swapMode: opts.swapMode,
    },
  });
}

export function buildSwap(opts: {
  userPublicKey: string;
  quoteResponse: Record<string, unknown>;
  visibility?: Visibility;
  destination?: string;
  minDelayMs?: string;
  maxDelayMs?: string;
  split?: number;
  validator?: string;
}) {
  return api<{ swapTransaction: string; lastValidBlockHeight: number; privateTransfer?: unknown }>(
    "/v1/swap/swap",
    {
      method: "POST",
      body: JSON.stringify({
        userPublicKey: opts.userPublicKey,
        quoteResponse: opts.quoteResponse,
        visibility: opts.visibility ?? "public",
        destination: opts.destination,
        minDelayMs: opts.minDelayMs,
        maxDelayMs: opts.maxDelayMs,
        split: opts.split,
        validator: opts.validator,
      }),
    },
  );
}

// ---------------------------------------------------------------------------
// Sign + submit a BuiltTx to the chain the API names in `sendTo`.
// ---------------------------------------------------------------------------
export async function signAndSend(
  built: BuiltTx,
  signers: Keypair[],
  connections: { base: Connection; er: Connection },
): Promise<string> {
  const raw = Buffer.from(built.transactionBase64, "base64");
  const conn = built.sendTo === "ephemeral" ? connections.er : connections.base;

  if (built.version === "v0") {
    const tx = VersionedTransaction.deserialize(raw);
    tx.sign(signers);
    const sig = await conn.sendRawTransaction(tx.serialize(), {
      skipPreflight: true,
    });
    await conn.confirmTransaction(sig, "confirmed");
    return sig;
  }

  const tx = Transaction.from(raw);
  // The API supplies its own recentBlockhash; keep it (ER blockhash differs).
  for (const s of signers) tx.partialSign(s);
  const sig = await conn.sendRawTransaction(tx.serialize(), {
    skipPreflight: true,
  });
  const conf = await conn.confirmTransaction(
    { signature: sig, blockhash: built.recentBlockhash, lastValidBlockHeight: built.lastValidBlockHeight },
    "confirmed",
  );
  if (conf.value.err) {
    throw new Error(`${built.kind} tx ${sig} failed on-chain: ${JSON.stringify(conf.value.err)}`);
  }
  return sig;
}

export function connections() {
  return {
    base: new Connection(SOLANA_DEVNET_RPC, "confirmed"),
    er: new Connection(TEE_ER_ENDPOINT, "confirmed"),
  };
}
