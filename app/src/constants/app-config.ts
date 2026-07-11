/**
 * AppConfig — single source of truth for app identity and the cluster(s) it
 * talks to, mirroring create-solana-dapp's `constants/app-config.ts` convention.
 *
 * This app is devnet-only by design (see lib/constants), and its "cluster" is
 * really a pair of endpoints: the Solana base layer plus the TEE ephemeral
 * rollup that makes balances private. The cluster shape below captures both.
 */
import {
  SOLANA_DEVNET_RPC,
  TEE_ER_ENDPOINT,
  PAYMENTS_API,
  USDC_DEVNET,
  VAULT_PROGRAM_ID,
} from '../lib/constants';

export enum ClusterNetwork {
  Devnet = 'devnet',
}

export interface AppCluster {
  /** CAIP-2 style id, e.g. "solana:devnet". */
  id: string;
  name: string;
  network: ClusterNetwork;
  /** Solana base-layer RPC (vault PDAs, deposits/withdraws). */
  base: string;
  /** TEE ephemeral-rollup endpoint (private balances). */
  tee: string;
  /** Hosted private-payments API (tx builders). */
  paymentsApi: string;
  usdcMint: string;
  vaultProgramId: string;
}

export class AppConfig {
  static name = 'Palm';
  static uri = 'https://usepalm.io';
  static clusters: AppCluster[] = [
    {
      id: 'solana:devnet',
      name: 'Devnet · TEE',
      network: ClusterNetwork.Devnet,
      base: SOLANA_DEVNET_RPC,
      tee: TEE_ER_ENDPOINT,
      paymentsApi: PAYMENTS_API,
      usdcMint: USDC_DEVNET,
      vaultProgramId: VAULT_PROGRAM_ID,
    },
  ];
}
