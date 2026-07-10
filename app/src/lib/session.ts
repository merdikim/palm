/**
 * session.ts — bearer-token cache with expiry-aware refresh.
 *
 * The TEE `/auth` flow issues JWTs (spikes S1). We cache the current token in
 * secure storage and transparently re-authenticate (via the `Signer`) when it
 * is missing or within a refresh skew of expiry. All private reads/submits go
 * through `getTeeToken`.
 */
import * as SecureStore from 'expo-secure-store';
import { teeAuth, type TeeSession } from './tee';
import type { Signer } from './signer';

const SESSION_STORE = 'palm.tee.session.v1';
// Refresh a bit before the token actually expires to avoid mid-request expiry.
const REFRESH_SKEW_MS = 60_000;

let memo: TeeSession | null = null;

function isFresh(s: TeeSession | null, now = Date.now()): s is TeeSession {
  return !!s && s.expiresAt - REFRESH_SKEW_MS > now;
}

async function loadStored(): Promise<TeeSession | null> {
  if (memo) return memo;
  const raw = await SecureStore.getItemAsync(SESSION_STORE);
  if (!raw) return null;
  try {
    memo = JSON.parse(raw) as TeeSession;
    return memo;
  } catch {
    return null;
  }
}

async function persist(s: TeeSession): Promise<void> {
  memo = s;
  await SecureStore.setItemAsync(SESSION_STORE, JSON.stringify(s));
}

/** Return a valid TEE token for `signer`, refreshing via /auth if needed. */
export async function getTeeToken(signer: Signer): Promise<string> {
  const cached = await loadStored();
  if (isFresh(cached) && cached.pubkey === signer.publicKey.toBase58()) {
    return cached.token;
  }
  const fresh = await teeAuth(signer);
  await persist(fresh);
  return fresh.token;
}

/** Force a fresh login (e.g. after a 401). */
export async function refreshTeeToken(signer: Signer): Promise<string> {
  const fresh = await teeAuth(signer);
  await persist(fresh);
  return fresh.token;
}

/** Peek at the cached session without triggering a network refresh. */
export async function peekSession(): Promise<TeeSession | null> {
  return loadStored();
}

export async function clearSession(): Promise<void> {
  memo = null;
  await SecureStore.deleteItemAsync(SESSION_STORE);
}
