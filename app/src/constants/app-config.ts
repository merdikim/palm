/**
 * AppConfig — single source of truth for app identity and the cluster(s) it
 * talks to, mirroring create-solana-dapp's `constants/app-config.ts` convention.
 *
 * This app runs on mainnet (see lib/constants), and its "cluster" is really a
 * pair of endpoints: the Solana base layer plus the TEE ephemeral rollup that
 * makes balances private. The cluster shape below captures both.
 */
import Constants from 'expo-constants';
import {
  SOLANA_RPC,
  TEE_ER_ENDPOINT,
  PAYMENTS_API,
  USDC_MINT,
  VAULT_PROGRAM_ID,
} from '../lib/constants';

/** The build's display name (env-specific: "Palm", "Palm (Dev)", …). */
export const APP_NAME = Constants.expoConfig?.name ?? 'Palm';
/** Which environment this build is (development | preview | production). */
export const APP_ENV =
  (Constants.expoConfig?.extra?.appEnv as string | undefined) ?? 'development';

export enum ClusterNetwork {
  Mainnet = 'mainnet',
}

export interface AppCluster {
  /** CAIP-2 style id, e.g. "solana:mainnet". */
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
  static name = APP_NAME;
  static uri = 'https://usepalm.io';
  static clusters: AppCluster[] = [
    {
      id: 'solana:mainnet',
      name: 'Mainnet · TEE',
      network: ClusterNetwork.Mainnet,
      base: SOLANA_RPC,
      tee: TEE_ER_ENDPOINT,
      paymentsApi: PAYMENTS_API,
      usdcMint: USDC_MINT,
      vaultProgramId: VAULT_PROGRAM_ID,
    },
  ];
}
