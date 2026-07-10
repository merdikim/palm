/**
 * TEE-native layer for the private user-balance path.
 *
 * Phase 0 finding (docs/spikes.md S2): the hosted Payments API only *builds*
 * transactions. Its `private-balance` read and ER submission are bound to the
 * service's own validator (MAS1) and its own token issuer. To keep the user's
 * balance on the TEE-backed validator (the prompt's privacy requirement) we:
 *   1. build txs via the Payments API with validator = TEE,
 *   2. authenticate against the TEE RPC's OWN /auth flow (a JWT), and
 *   3. read balances + submit ER transactions directly against the TEE RPC,
 *      passing the token as `?token=` on the URL.
 *
 * Privacy is enforced at TEE ingress by the query-filtering service: a wallet
 * with a valid token can read only its own private accounts; everyone else —
 * even with their own valid token — sees `value: null`. Verified live.
 */
import nacl from "tweetnacl";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { TEE_ER_ENDPOINT } from "./constants.js";

export interface TeeSession {
  pubkey: string;
  token: string;
  expiresAt: number;
}

/** Authenticate against the TEE RPC's native /auth flow. Returns a JWT. */
export async function teeAuth(kp: Keypair, endpoint = TEE_ER_ENDPOINT): Promise<TeeSession> {
  const pubkey = kp.publicKey.toBase58();
  const cRes = await fetch(`${endpoint}/auth/challenge?pubkey=${pubkey}`);
  const cJson = (await cRes.json()) as { challenge?: string; error?: string };
  if (!cJson.challenge) throw new Error(`TEE challenge failed: ${cJson.error ?? "no challenge"}`);
  const sig = nacl.sign.detached(new TextEncoder().encode(cJson.challenge), kp.secretKey);
  const bs58 = (await import("bs58")).default;
  const lRes = await fetch(`${endpoint}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pubkey, challenge: cJson.challenge, signature: bs58.encode(sig) }),
  });
  const lJson = (await lRes.json()) as { token?: string; expiresAt?: number; error?: string };
  if (lRes.status !== 200 || !lJson.token) throw new Error(`TEE login failed: ${lJson.error ?? lRes.status}`);
  return {
    pubkey,
    token: lJson.token,
    expiresAt: lJson.expiresAt ?? Date.now() + 1000 * 60 * 60 * 24 * 30,
  };
}

/** A web3.js Connection whose URL carries the query-filtering token. */
export function teeConnection(token: string, endpoint = TEE_ER_ENDPOINT): Connection {
  return new Connection(`${endpoint}/?token=${token}`, "confirmed");
}

/**
 * Read the private token balance for `owner`+`mint` directly from the TEE ER.
 *
 * The Ephemeral SPL Token "Model A" flow the hosted deposit uses materializes
 * the ER balance as a normal SPL token account at the owner's CANONICAL ATA
 * (verified: deposits land there, not in the eATA bookkeeping account). So we
 * read the canonical ATA's token amount through the tokened TEE connection.
 *
 * Returns 0n when the account is absent OR the caller is not permitted to see
 * it — the TEE query filter returns null for foreign accounts.
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
  return info.data.readBigUInt64LE(64); // SPL token account: amount @ offset 64
}

/** Canonical ATA that holds the ER balance for owner+mint (Model A). */
export function ataOf(owner: PublicKey, mint: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(mint, owner, true);
}

/**
 * Submit a signed legacy transaction to the TEE ER with the caller's token.
 * `built.recentBlockhash` from the API is used verbatim.
 */
export async function submitTeeTx(
  txBase64: string,
  signers: Keypair[],
  token: string,
  _blockhash: string,
  _lastValidBlockHeight: number,
  endpoint = TEE_ER_ENDPOINT,
): Promise<string> {
  const conn = teeConnection(token, endpoint);
  const tx = Transaction.from(Buffer.from(txBase64, "base64"));
  // ER transactions must carry the ER's own blockhash, not the API's. We sign
  // client-side, so re-stamp the blockhash before signing.
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  for (const s of signers) tx.partialSign(s);
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  const conf = await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  if (conf.value.err) {
    throw new Error(`ER tx ${sig} failed on-chain: ${JSON.stringify(conf.value.err)}`);
  }
  return sig;
}
