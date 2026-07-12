import React, { createContext, useContext } from 'react';
import { AppConfig, type AppCluster } from '../constants/app-config';

interface ClusterState {
  cluster: AppCluster;
}

const Ctx = createContext<ClusterState | null>(null);
const value: ClusterState = { cluster: AppConfig.clusters[0] };

export function ClusterProvider({ children }: { children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCluster(): ClusterState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useCluster must be used within ClusterProvider');
  return v;
}
