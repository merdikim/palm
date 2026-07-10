/**
 * Shared devnet constants for the Private Payments prototype.
 *
 * DEVNET ONLY. There are no mainnet endpoints anywhere in this repo by design.
 * Every network call is scoped to `cluster=devnet` and, for private flows, to
 * the MagicBlock devnet TEE validator.
 *
 * All values below were verified live against the services during Phase 0
 * spikes (see docs/spikes.md).
 */

// ---------------------------------------------------------------------------
// Base-layer Solana (devnet)
// ---------------------------------------------------------------------------
export const SOLANA_DEVNET_RPC = "https://api.devnet.solana.com";
// MagicBlock's sponsored base-layer RPC (clones ER state, better for delegation)
export const MAGICBLOCK_BASE_RPC = "https://rpc.magicblock.app/devnet";

// ---------------------------------------------------------------------------
// MagicBlock routing + ephemeral rollup (devnet)
// ---------------------------------------------------------------------------
export const ROUTER_ENDPOINT = "https://devnet-router.magicblock.app";
export const ROUTER_WS_ENDPOINT = "wss://devnet-router.magicblock.app";

// The TEE-backed devnet validator — this is what makes rollups *private*.
// Identity verified via getIdentity on 2026-07-10.
export const TEE_ER_ENDPOINT = "https://devnet-tee.magicblock.app";
export const TEE_ER_WS_ENDPOINT = "wss://devnet-tee.magicblock.app";
export const TEE_VALIDATOR_IDENTITY =
  "MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo";

// The non-TEE (public) devnet ER default, used by the Payments API when no
// validator override is supplied. We DO NOT use this for private flows.
export const DEFAULT_DEVNET_VALIDATOR =
  "MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57";

// ---------------------------------------------------------------------------
// Hosted Private Payments API
// ---------------------------------------------------------------------------
export const PAYMENTS_API = "https://payments.magicblock.app";
export const PAYMENTS_CLUSTER = "devnet";

// ---------------------------------------------------------------------------
// Mints (devnet)
// ---------------------------------------------------------------------------
// Devnet USDC. Verified initialized on BOTH the default devnet validator and
// the TEE validator (transfer queue 5REWqpSxnWsbsGZdMXrRaP8s4UaVjbuuXcGvwCwMs5Gx).
export const USDC_DEVNET = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
export const USDC_DECIMALS = 6;

// ---------------------------------------------------------------------------
// MagicBlock program IDs
// ---------------------------------------------------------------------------
export const DELEGATION_PROGRAM_ID =
  "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh";
export const MAGIC_PROGRAM_ID = "Magic11111111111111111111111111111111111111";
export const MAGIC_CONTEXT_ID = "MagicContext1111111111111111111111111111111";
export const PERMISSION_PROGRAM_ID =
  "ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1";
export const ESPL_TOKEN_PROGRAM_ID =
  "SPLxh1LVZzEkX99H6rqYizhytLWPZVV296zyYDPagv2";

// The vault program (this project). Placeholder until first `anchor build`
// generates a real keypair; kept in sync with programs/vault/Anchor.toml.
export const VAULT_PROGRAM_ID = "Vau1t1111111111111111111111111111111111111";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
export const usdc = (dollars: number): bigint =>
  BigInt(Math.round(dollars * 10 ** USDC_DECIMALS));
export const fromUsdc = (base: bigint | number): number =>
  Number(base) / 10 ** USDC_DECIMALS;
