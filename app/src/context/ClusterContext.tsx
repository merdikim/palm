/**
 * ClusterContext — exposes the selected AppCluster (endpoints, mint, program id)
 * and the list of available clusters, mirroring create-solana-dapp's
 * `cluster-provider`. This app ships a single devnet/TEE cluster today, but the
 * selection surface is kept so adding clusters later is a config-only change.
 */
import React, { createContext, useContext, useMemo, useState } from 'react';
import { AppConfig, type AppCluster } from '../constants/app-config';

interface ClusterState {
  cluster: AppCluster;
  clusters: AppCluster[];
  setCluster: (id: string) => void;
}

const Ctx = createContext<ClusterState | null>(null);

export function ClusterProvider({ children }: { children: React.ReactNode }) {
  const [selectedId, setSelectedId] = useState(AppConfig.clusters[0].id);

  const value = useMemo<ClusterState>(() => {
    const cluster = AppConfig.clusters.find((c) => c.id === selectedId) ?? AppConfig.clusters[0];
    return {
      cluster,
      clusters: AppConfig.clusters,
      setCluster: setSelectedId,
    };
  }, [selectedId]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCluster(): ClusterState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useCluster must be used within ClusterProvider');
  return v;
}
