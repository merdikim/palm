/**
 * Typed client for the MagicBlock hosted Private Payments API, RN-adapted from
 * `shared/payments.ts`.
 *
 * The API is stateless — it only *builds* unsigned transactions. This client
 * builds; the caller signs (via the `Signer`) and submits to the chain named in
 * `sendTo` (base = mainnet base layer, ephemeral = TEE with `?token=`). Every
 * request pins `cluster=mainnet`; private flows pin the TEE validator.
 */
import { Transaction, VersionedTransaction } from '@solana/web3.js';
import { Buffer } from './buffer';
import bs58 from 'bs58';
import {
  PAYMENTS_API,
  PAYMENTS_CLUSTER,
  TEE_VALIDATOR_IDENTITY,
  USDC_DECIMALS,
  USDC_MINT,
} from './constants';
import { baseConnection, teeConnection } from './connections';
import type { Signer } from './signer';

// The screens pass whole-token (UI) amounts — `12.5` means $12.50. The Payments
// API and the on-chain SPL program work in base units, so every amount is scaled
// by the mint's denominator (10^decimals) before we build the tx the wallet
// signs. Convention: a `number` is whole tokens (scaled here); a `bigint` is
// already in base units (passed through). USDC-only → USDC_DECIMALS.
const toBaseUnits = (amount: number | bigint): number =>
  typeof amount === 'bigint'
    ? Number(amount)
    : Math.round(amount * 10 ** USDC_DECIMALS);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface BuiltTx {
  kind: string;
  version: 'legacy' | 'v0';
  transactionBase64: string;
  sendTo: 'base' | 'ephemeral';
  recentBlockhash: string;
  lastValidBlockHeight: number;
  instructionCount: number;
  requiredSigners: string[];
  validator: string;
}

export type Visibility = 'public' | 'private';
export type BalanceLoc = 'base' | 'ephemeral';

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
    headers: { 'content-type': 'application/json', ...(rest.headers ?? {}) },
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
// Hosted Payments API auth (challenge -> sign -> login). Distinct from TEE
// /auth. Used for the hosted balance endpoints only.
// ---------------------------------------------------------------------------
export interface ApiSession {
  pubkey: string;
  token: string;
  issuedAt: number;
}

export async function apiLogin(signer: Signer): Promise<ApiSession> {
  const pubkey = signer.publicKey.toBase58();
  const { challenge } = await api<{ challenge: string }>('/v1/spl/challenge', {
    method: 'GET',
    query: { pubkey, cluster: PAYMENTS_CLUSTER },
  });
  const sig = await signer.signMessage(new TextEncoder().encode(challenge));
  const { token } = await api<{ token: string }>('/v1/spl/login', {
    method: 'POST',
    body: JSON.stringify({
      pubkey,
      challenge: challenge,
      signature: bs58.encode(sig),
      cluster: PAYMENTS_CLUSTER,
    }),
  });
  return { pubkey, token: token, issuedAt: Date.now() };
}

// ---------------------------------------------------------------------------
// Deposit / withdraw / transfer (validator pinned to the TEE validator so
// balances land on the private rollup — see spikes S2#4).
// ---------------------------------------------------------------------------
export function buildDeposit(opts: {
  owner: string;
  amount: number | bigint;
  mint?: string;
}): Promise<BuiltTx> {
  return api<BuiltTx>('/v1/spl/deposit', {
    method: 'POST',
    body: JSON.stringify({
      owner: opts.owner,
      amount: toBaseUnits(opts.amount),
      mint: opts.mint ?? USDC_MINT,
      cluster: PAYMENTS_CLUSTER,
      validator: TEE_VALIDATOR_IDENTITY,
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
}): Promise<BuiltTx> {
  return api<BuiltTx>('/v1/spl/withdraw', {
    method: 'POST',
    body: JSON.stringify({
      owner: opts.owner,
      amount: toBaseUnits(opts.amount),
      mint: opts.mint ?? USDC_MINT,
      cluster: PAYMENTS_CLUSTER,
      validator: TEE_VALIDATOR_IDENTITY,
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
    memo?: string;
    minDelayMs?: string;
    maxDelayMs?: string;
    split?: number;
  },
  token?: string,
): Promise<BuiltTx> {
  const headers: Record<string, string> = {};
  if (token) headers['authorization'] = `Bearer ${token}`;
  return api<BuiltTx>('/v1/spl/transfer', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      from: opts.from,
      to: opts.to,
      mint: opts.mint ?? USDC_MINT,
      amount: toBaseUnits(opts.amount),
      visibility: opts.visibility,
      fromBalance: opts.fromBalance,
      toBalance: opts.toBalance,
      cluster: PAYMENTS_CLUSTER,
      validator: TEE_VALIDATOR_IDENTITY,
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
export function baseBalance(address: string, mint = USDC_MINT) {
  return api<{ balance: string; ata: string; location: string }>(
    '/v1/spl/balance',
    { method: 'GET', query: { address, mint, cluster: PAYMENTS_CLUSTER } },
  );
}

// ---------------------------------------------------------------------------
// Swap (devnet has no route — see spikes S5; kept for interface completeness)
// ---------------------------------------------------------------------------
export function swapQuote(opts: {
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps?: number;
  swapMode?: 'ExactIn' | 'ExactOut';
}) {
  return api<Record<string, unknown>>('/v1/swap/quote', {
    method: 'GET',
    query: {
      inputMint: opts.inputMint,
      outputMint: opts.outputMint,
      amount: opts.amount,
      slippageBps: opts.slippageBps?.toString(),
      swapMode: opts.swapMode,
    },
  });
}

// ---------------------------------------------------------------------------
// Sign + submit a BuiltTx to the chain the API names in `sendTo`.
//   base       -> mainnet base layer, use API's blockhash verbatim
//   ephemeral  -> TEE ER, re-stamp the ER blockhash before signing (S2#6),
//                 token required (`?token=`)
// Always checks confirmTransaction().value.err (S2#8).
// ---------------------------------------------------------------------------
export async function signAndSend(
  built: BuiltTx,
  signer: Signer,
  teeToken?: string,
): Promise<string> {
  const raw = Buffer.from(built.transactionBase64, 'base64');

  if (built.sendTo === 'ephemeral') {
    if (!teeToken) {
      throw new Error('ephemeral submit requires a TEE token');
    }
    const conn = teeConnection(teeToken);
    const { blockhash, lastValidBlockHeight } =
      await conn.getLatestBlockhash('confirmed');
    if (built.version === 'v0') {
      const tx = VersionedTransaction.deserialize(raw);
      // v0 blockhash lives in the message; the API-supplied one is used as-is.
      const signed = await signer.signTransaction(tx);
      const sig = await conn.sendRawTransaction(signed.serialize(), {
        skipPreflight: true,
      });
      await confirmOrThrow(conn, sig, built);
      return sig;
    }
    const tx = Transaction.from(raw);
    tx.recentBlockhash = blockhash;
    const signed = await signer.signTransaction(tx);
    const sig = await conn.sendRawTransaction(signed.serialize(), {
      skipPreflight: true,
    });
    const conf = await conn.confirmTransaction(
      { signature: sig, blockhash, lastValidBlockHeight },
      'confirmed',
    );
    throwOnErr(conf.value.err, built, sig);
    return sig;
  }

  // base layer
  const conn = baseConnection();
  if (built.version === 'v0') {
    const tx = VersionedTransaction.deserialize(raw);
    const signed = await signer.signTransaction(tx);
    const sig = await conn.sendRawTransaction(signed.serialize(), {
      skipPreflight: true,
    });
    await confirmOrThrow(conn, sig, built);
    return sig;
  }
  const tx = Transaction.from(raw);
  const signed = await signer.signTransaction(tx);
  const sig = await conn.sendRawTransaction(signed.serialize(), {
    skipPreflight: true,
  });
  const conf = await conn.confirmTransaction(
    {
      signature: sig,
      blockhash: built.recentBlockhash,
      lastValidBlockHeight: built.lastValidBlockHeight,
    },
    'confirmed',
  );
  throwOnErr(conf.value.err, built, sig);
  return sig;
}

async function confirmOrThrow(
  conn: ReturnType<typeof baseConnection>,
  sig: string,
  built: BuiltTx,
): Promise<void> {
  const conf = await conn.confirmTransaction(sig, 'confirmed');
  throwOnErr(conf.value.err, built, sig);
}

function throwOnErr(err: unknown, built: BuiltTx, sig: string): void {
  if (!err) return;
  const s = JSON.stringify(err);
  // spikes S2#7: an ER->ER transfer writes the recipient's ATA, which must be
  // delegated (the recipient must have "onboarded"). Surface a friendly hint.
  if (s.includes('InvalidWritableAccount')) {
    throw new RecipientNotOnboardedError(built.kind, sig);
  }
  throw new Error(`${built.kind} tx ${sig} failed on-chain: ${s}`);
}

/** Thrown when a private transfer targets a recipient that has not onboarded. */
export class RecipientNotOnboardedError extends Error {
  constructor(
    public kind: string,
    public signature: string,
  ) {
    super(
      'This recipient has not set up private payments yet. They need to make a ' +
        'first deposit (onboard) before they can receive.',
    );
    this.name = 'RecipientNotOnboardedError';
  }
}
