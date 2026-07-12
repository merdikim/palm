/**
 * apiSession.ts — bearer-token cache for the hosted Payments API.
 *
 * DISTINCT from `session.ts` (the TEE `/auth` JWT). The Payments API has its own
 * auth domain: challenge -> sign -> `/v1/spl/login` (see `apiLogin`). Its token
 * is what the hosted `/v1/spl/*` endpoints verify via `Authorization: Bearer`.
 * A TEE token is NOT accepted here (different issuer), so private hosted calls
 * must carry the token from THIS module.
 *
 * The login response carries no explicit expiry, so we refresh opportunistically
 * on a conservative max-age and let callers force a refresh after a 401/403.
 */
import * as SecureStore from 'expo-secure-store';
import { apiLogin, type ApiSession } from './payments';
import type { Signer } from './signer';

const API_STORE = 'palm.api.session.v1';
// No server-provided expiry — re-login well within any reasonable token TTL.
const MAX_AGE_MS = 50 * 60_000;

let memo: ApiSession | null = null;

function isFresh(s: ApiSession | null, now = Date.now()): s is ApiSession {
  return !!s && now - s.issuedAt < MAX_AGE_MS;
}

async function loadStored(): Promise<ApiSession | null> {
  if (memo) return memo;
  const raw = await SecureStore.getItemAsync(API_STORE);
  if (!raw) return null;
  try {
    memo = JSON.parse(raw) as ApiSession;
    return memo;
  } catch {
    return null;
  }
}

async function persist(s: ApiSession): Promise<void> {
  memo = s;
  await SecureStore.setItemAsync(API_STORE, JSON.stringify(s));
}

/** Return a valid Payments-API token for `signer`, re-logging in if needed. */
export async function getApiToken(signer: Signer): Promise<string> {
  const cached = await loadStored();
  if (isFresh(cached) && cached.pubkey === signer.publicKey.toBase58()) {
    return cached.token;
  }
  const fresh = await apiLogin(signer);
  await persist(fresh);
  return fresh.token;
}

/** Force a fresh Payments-API login (e.g. after a 401/403). */
export async function refreshApiToken(signer: Signer): Promise<string> {
  const fresh = await apiLogin(signer);
  await persist(fresh);
  return fresh.token;
}

export async function clearApiSession(): Promise<void> {
  memo = null;
  await SecureStore.deleteItemAsync(API_STORE);
}
