/**
 * Local registries kept in secure storage.
 *
 * Two on-chain discovery problems are awkward for a thin client, so we keep
 * local hints:
 *   - Vaults: enumerating a wallet's own vault PDAs on-chain is awkward, so we
 *     remember the agent pubkeys we created vaults for.
 *   - Links: a claim link's secret is the only key to its funds, so we persist
 *     outgoing links to re-share or reclaim them (they are otherwise stateless
 *     throwaway accounts we could never rediscover).
 *
 * These are convenience caches only — the chain remains the source of truth.
 */
import * as SecureStore from 'expo-secure-store';

const VAULTS_STORE = 'palm.registry.vaults.v1';
const LINKS_STORE = 'palm.registry.links.v1';

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

// --- Outgoing claim-link registry -------------------------------------------
// The link's secret is the ONLY key to its funds. We persist it so a sender who
// dismissed the share sheet (or whose recipient never claims) can re-share or
// reclaim — otherwise the funds would be stranded on the throwaway account.
export interface LinkEntry {
  url: string; // full palm://claim#… (carries the secret)
  linkAddress: string; // throwaway account pubkey (base58)
  amount: string; // base units (USDC)
  memo?: string;
  createdAt: number;
}

export async function listLinkEntries(): Promise<LinkEntry[]> {
  return readJson<LinkEntry[]>(LINKS_STORE, []);
}

export async function addLinkEntry(entry: LinkEntry): Promise<void> {
  const all = await listLinkEntries();
  if (all.some((l) => l.linkAddress === entry.linkAddress)) return;
  all.push(entry);
  await writeJson(LINKS_STORE, all);
}

export async function removeLinkEntry(linkAddress: string): Promise<void> {
  const all = await listLinkEntries();
  await writeJson(
    LINKS_STORE,
    all.filter((l) => l.linkAddress !== linkAddress),
  );
}

export async function clearRegistries(): Promise<void> {
  await SecureStore.deleteItemAsync(VAULTS_STORE);
  await SecureStore.deleteItemAsync(LINKS_STORE);
}
