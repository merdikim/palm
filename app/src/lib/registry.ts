/**
 * Local registries kept in secure storage.
 *
 * Two on-chain discovery problems are awkward for a thin client, so we keep
 * local hints (spikes S3/S4):
 *   - Vaults: enumerating a wallet's own vault PDAs on-chain is awkward, so we
 *     remember the agent pubkeys we created vaults for.
 *   - Requests: we remember request ids we created / are involved in, alongside
 *     the deterministic counter-based derivation, so we can derive+fetch without
 *     a full program scan.
 *
 * These are convenience caches only — the chain remains the source of truth.
 */
import * as SecureStore from 'expo-secure-store';

const VAULTS_STORE = 'palm.registry.vaults.v1';
const REQUESTS_STORE = 'palm.registry.requests.v1';

// --- Agent (vault) registry -------------------------------------------------
export interface VaultEntry {
  agent: string; // agent pubkey (base58)
  label?: string;
  createdAt: number;
}

async function readJson<T>(key: string, fallback: T): Promise<T> {
  const raw = await SecureStore.getItemAsync(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(key: string, value: unknown): Promise<void> {
  await SecureStore.setItemAsync(key, JSON.stringify(value));
}

export async function listVaultEntries(): Promise<VaultEntry[]> {
  return readJson<VaultEntry[]>(VAULTS_STORE, []);
}

export async function addVaultEntry(entry: VaultEntry): Promise<void> {
  const all = await listVaultEntries();
  if (all.some((v) => v.agent === entry.agent)) return;
  all.push(entry);
  await writeJson(VAULTS_STORE, all);
}

export async function removeVaultEntry(agent: string): Promise<void> {
  const all = await listVaultEntries();
  await writeJson(
    VAULTS_STORE,
    all.filter((v) => v.agent !== agent),
  );
}

// --- Request registry -------------------------------------------------------
export type RequestDirection = 'to_me' | 'from_me' | 'agent_approval';

export interface RequestEntry {
  payer: string; // the payer pubkey the request PDA is seeded by
  requestId: string; // u64 as string
  direction: RequestDirection;
  createdAt: number;
}

export async function listRequestEntries(): Promise<RequestEntry[]> {
  return readJson<RequestEntry[]>(REQUESTS_STORE, []);
}

export async function addRequestEntry(entry: RequestEntry): Promise<void> {
  const all = await listRequestEntries();
  if (all.some((r) => r.payer === entry.payer && r.requestId === entry.requestId)) {
    return;
  }
  all.push(entry);
  await writeJson(REQUESTS_STORE, all);
}

export async function clearRegistries(): Promise<void> {
  await SecureStore.deleteItemAsync(VAULTS_STORE);
  await SecureStore.deleteItemAsync(REQUESTS_STORE);
}
