/**
 * TEE-native layer for the private user-balance path, RN-adapted from
 * `shared/tee.ts`.
 *
 * Phase 0 (spikes S2): the hosted Payments API only *builds* transactions, and
 * its private reads are neither TEE-bound nor per-wallet private. So the user
 * balance path is TEE-native:
 *   1. build txs via the Payments API with validator = TEE,
 *   2. authenticate against the TEE RPC's own `/auth` flow (a JWT),
 *   3. read balances + submit ER txs directly against the TEE RPC (`?token=`).
 *
 * Adapted for RN: signing goes through the `Signer` interface (not a raw
 * Keypair), and there is no `node:*` usage.
 */
import { Buffer } from './buffer';
import { PublicKey, Transaction } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import bs58 from 'bs58';
import {
  TEE_ER_ENDPOINT,
  ESPL_TOKEN_PROGRAM_ID,
  DELEGATION_PROGRAM_ID,
} from './constants';
import { teeConnection, baseConnection } from './connections';
import type { Signer } from './signer';

export interface TeeSession {
  pubkey: string;
  token: string;
  expiresAt: number;
}

/** Authenticate against the TEE RPC's native /auth flow. Returns a JWT session. */
export async function teeAuth(
  signer: Signer,
  endpoint = TEE_ER_ENDPOINT,
): Promise<TeeSession> {
  const pubkey = signer.publicKey.toBase58();
  const cRes = await fetch(`${endpoint}/auth/challenge?pubkey=${pubkey}`);
  const cJson = (await cRes.json()) as { challenge?: string; error?: string };
  if (!cJson.challenge) {
    throw new Error(`TEE challenge failed: ${cJson.error ?? 'no challenge'}`);
  }
  const sig = await signer.signMessage(
    new TextEncoder().encode(cJson.challenge),
  );
  const lRes = await fetch(`${endpoint}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      pubkey,
      challenge: cJson.challenge,
      signature: bs58.encode(sig),
    }),
  });
  const lJson = (await lRes.json()) as {
    token?: string;
    expiresAt?: number;
    error?: string;
  };
  if (lRes.status !== 200 || !lJson.token) {
    throw new Error(`TEE login failed: ${lJson.error ?? lRes.status}`);
  }
  return {
    pubkey,
    token: lJson.token,
    expiresAt: lJson.expiresAt ?? Date.now() + 1000 * 60 * 60 * 24 * 30,
  };
}

/** Canonical ATA that holds the ER balance for owner+mint (Model A). */
export function ataOf(owner: PublicKey, mint: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(mint, owner, true);
}

/**
 * The Ephemeral SPL "eATA" PDA for owner+mint — seeds `[owner, mint]` under the
 * Ephemeral SPL Token program.
 *
 * This is the account the deposit DELEGATES, and it is the only reliable
 * on-base signal that a wallet has been onboarded. The owner's canonical ATA is
 * NOT delegated: a deposit moves the tokens into a per-mint global vault and
 * records the balance in the eATA, leaving the canonical ATA an ordinary
 * SPL-Token-owned account. Once delegated, the eATA's base-layer owner is the
 * delegation program.
 */
export function eataOf(owner: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), mint.toBuffer()],
    new PublicKey(ESPL_TOKEN_PROGRAM_ID),
  )[0];
}

/**
 * Has `owner` onboarded this mint onto the ER? True iff the eATA exists on base
 * and has been reassigned to the delegation program.
 *
 * Needed because the ER CLONES base state for accounts it has never seen
 * (spikes S2#9): reading the canonical ATA on the ER for a non-delegated wallet
 * returns its PUBLIC balance, which we must not present as a private one.
 */
export async function isDelegated(
  owner: PublicKey,
  mint: PublicKey,
): Promise<boolean> {
  const info = await baseConnection().getAccountInfo(eataOf(owner, mint));
  return !!info && info.owner.equals(new PublicKey(DELEGATION_PROGRAM_ID));
}

/**
 * Read the private token balance for owner+mint directly from the TEE ER.
 *
 * The deposit (Ephemeral SPL "Model A") materializes the ER balance at the
 * owner's CANONICAL ATA, so we read that account's amount through the tokened
 * connection. Returns 0n when the account is absent OR the caller is not
 * permitted to see it (the TEE query filter returns null for foreign accounts).
 *
 * CAVEAT (spikes S2#9): a non-delegated account returns the cloned base
 * balance, indistinguishable by amount alone. Treat "onboarded/delegated" as a
 * separate state, not something inferred from a nonzero read.
 */
export async function readTeeBalance(
  owner: PublicKey,
  mint: PublicKey,
  token: string,
  endpoint = TEE_ER_ENDPOINT,
): Promise<bigint> {
  const ata = getAssociatedTokenAddressSync(mint, owner, true);
  const conn = teeConnection(token, endpoint);
  const info = await conn.getAccountInfo(ata);
  if (!info || info.data.length < 72) return 0n;
  return Buffer.from(info.data).readBigUInt64LE(64); // SPL amount @ offset 64
}

/**
 * Submit a base64 legacy transaction to the TEE ER with the caller's token.
 * ER transactions must carry the ER's OWN blockhash (spikes S2#6), so we
 * re-stamp `recentBlockhash` from the tokened connection before signing.
 */
export async function submitTeeTx(
  txBase64: string,
  signer: Signer,
  token: string,
  endpoint = TEE_ER_ENDPOINT,
): Promise<string> {
  const conn = teeConnection(token, endpoint);
  const tx = Transaction.from(Buffer.from(txBase64, 'base64'));
  const { blockhash, lastValidBlockHeight } =
    await conn.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;
  const signed = await signer.signTransaction(tx);
  const sig = await conn.sendRawTransaction(signed.serialize(), {
    skipPreflight: true,
  });
  const conf = await conn.confirmTransaction(
    { signature: sig, blockhash, lastValidBlockHeight },
    'confirmed',
  );
  if (conf.value.err) {
    throw new Error(
      `ER tx ${sig} failed on-chain: ${JSON.stringify(conf.value.err)}`,
    );
  }
  return sig;
}

/**
 * Submit a locally-built `Transaction` (e.g. an ER-native vault instruction) to
 * the TEE ER. Same blockhash re-stamp + err-check discipline as submitTeeTx.
 */
export async function submitTeeTxObject(
  tx: Transaction,
  signer: Signer,
  token: string,
  endpoint = TEE_ER_ENDPOINT,
): Promise<string> {
  const conn = teeConnection(token, endpoint);
  const { blockhash, lastValidBlockHeight } =
    await conn.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;
  tx.feePayer = signer.publicKey;
  const signed = await signer.signTransaction(tx);
  const sig = await conn.sendRawTransaction(signed.serialize(), {
    skipPreflight: true,
  });
  const conf = await conn.confirmTransaction(
    { signature: sig, blockhash, lastValidBlockHeight },
    'confirmed',
  );
  if (conf.value.err) {
    throw new Error(
      `ER tx ${sig} failed on-chain: ${JSON.stringify(conf.value.err)}`,
    );
  }
  return sig;
}
