/**
 * App-local network constants.
 *
 * The RN app cannot import from `../../shared` (that tree uses node ESM +
 * `node:fs`), so these values are kept here directly.
 *
 * MAINNET. These are real endpoints and real funds — every flow moves live USDC.
 */

// ---------------------------------------------------------------------------
// Base-layer Solana (mainnet)
// ---------------------------------------------------------------------------
// MagicBlock's mainnet RPC — MagicBlock-native (clones ER state, better for
// delegation) and needs no API key. Swap in a paid RPC (Helius/Triton/QuickNode)
// here if you hit rate limits; `api.mainnet-beta.solana.com` is heavily throttled.
export const SOLANA_RPC = 'https://rpc.magicblock.app/mainnet';
export const MAGICBLOCK_BASE_RPC = 'https://rpc.magicblock.app/mainnet';

// ---------------------------------------------------------------------------
// MagicBlock routing + ephemeral rollup (mainnet)
// ---------------------------------------------------------------------------
export const ROUTER_ENDPOINT = 'https://router.magicblock.app';
export const ROUTER_WS_ENDPOINT = 'wss://router.magicblock.app';

// The TEE-backed validator — this is what makes rollups *private*. The mainnet
// TEE validator identity is the same key as devnet (verified via getIdentity).
export const TEE_ER_ENDPOINT = 'https://mainnet-tee.magicblock.app';
export const TEE_ER_WS_ENDPOINT = 'wss://mainnet-tee.magicblock.app';
export const TEE_VALIDATOR_IDENTITY =
  'MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo';

// ---------------------------------------------------------------------------
// Hosted Private Payments API
// ---------------------------------------------------------------------------
export const PAYMENTS_API = 'https://payments.magicblock.app';
export const PAYMENTS_CLUSTER = 'mainnet-private';

// ---------------------------------------------------------------------------
// Mints (mainnet)
// ---------------------------------------------------------------------------
// Circle USDC on Solana mainnet.
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const USDC_DECIMALS = 6;

// ---------------------------------------------------------------------------
// MagicBlock program IDs (same across clusters)
// ---------------------------------------------------------------------------
export const DELEGATION_PROGRAM_ID =
  'DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh';
export const MAGIC_PROGRAM_ID = 'Magic11111111111111111111111111111111111111';
export const MAGIC_CONTEXT_ID = 'MagicContext1111111111111111111111111111111';
export const PERMISSION_PROGRAM_ID =
  'ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1';
export const ESPL_TOKEN_PROGRAM_ID =
  'SPLxh1LVZzEkX99H6rqYizhytLWPZVV296zyYDPagv2';

// The vault program (this project). NOTE: this ID is the DEVNET deployment and
// does NOT exist on mainnet yet — the agents/vaults feature will fail until the
// program is deployed to mainnet and this ID is replaced with the mainnet one.
export const VAULT_PROGRAM_ID = '3955LkKVs64NZTo9dGKXAoRx7wAURcKstuXZxDqoqYtW';

// ---------------------------------------------------------------------------
// Notification relay (configurable; default local dev)
// ---------------------------------------------------------------------------
export const RELAY_BASE_URL = 'http://localhost:8787';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
export const usdc = (dollars: number): bigint =>
  BigInt(Math.round(dollars * 10 ** USDC_DECIMALS));
export const fromUsdc = (base: bigint | number): number =>
  Number(base) / 10 ** USDC_DECIMALS;
