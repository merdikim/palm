/**
 * Data hooks — the private balance, agent vaults, payment links, and the
 * local activity feed, all read through @tanstack/react-query.
 *
 * Follows create-solana-dapp's convention: a query-key factory per resource,
 * a `useX` query hook, and a single `useInvalidateData()` that busts the caches
 * after a mutating action. Reads live here (not in context) so any screen can
 * subscribe and stay in sync.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useWallet } from '../context/WalletContext';
import { useCluster } from '../context/ClusterContext';
import { getPrivateBalance, fetchAllVaults, fetchAllLinks } from '../lib/actions';
import { listActivity } from '../lib/activity';

// ── query-key factories ──────────────────────────────────────────────────────
export const balanceKey = (pubkey: string | null, endpoint: string) => ['balance', { endpoint, pubkey }] as const;
export const vaultsKey = (pubkey: string | null, endpoint: string) => ['vaults', { endpoint, pubkey }] as const;
export const linksKey = (pubkey: string | null, endpoint: string) => ['links', { endpoint, pubkey }] as const;
export const activityKey = () => ['activity'] as const;

// ── queries ──────────────────────────────────────────────────────────────────
export function useBalance() {
  const w = useWallet();
  const { cluster } = useCluster();
  return useQuery({
    queryKey: balanceKey(w.publicKey, cluster.tee),
    queryFn: () => getPrivateBalance(w.signer!),
    enabled: !!w.signer && w.step === 'done',
    staleTime: 10_000,
  });
}

export function useVaults() {
  const w = useWallet();
  const { cluster } = useCluster();
  return useQuery({
    queryKey: vaultsKey(w.publicKey, cluster.tee),
    queryFn: () => fetchAllVaults(w.signer!),
    enabled: !!w.signer && w.step === 'done',
    staleTime: 10_000,
  });
}

export function useLinks() {
  const w = useWallet();
  const { cluster } = useCluster();
  return useQuery({
    queryKey: linksKey(w.publicKey, cluster.tee),
    queryFn: () => fetchAllLinks(),
    enabled: !!w.signer && w.step === 'done',
    staleTime: 10_000,
  });
}

export function useActivity() {
  return useQuery({
    queryKey: activityKey(),
    queryFn: () => listActivity(),
  });
}

// ── invalidation ─────────────────────────────────────────────────────────────
/** Returns a fn that refetches balance, vaults, links, and activity. */
export function useInvalidateData() {
  const client = useQueryClient();
  return () => {
    client.invalidateQueries({ queryKey: ['balance'] });
    client.invalidateQueries({ queryKey: ['vaults'] });
    client.invalidateQueries({ queryKey: ['links'] });
    client.invalidateQueries({ queryKey: ['activity'] });
  };
}
