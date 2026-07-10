/**
 * Shared web3.js Connections.
 *
 * `base` — Solana devnet base layer (vault PDAs, deposits/withdraws land here).
 * `er(token)` — the TEE ephemeral rollup, tokened at the URL (`?token=`) so the
 * query-filtering service gates reads/submits to the caller's own private
 * accounts (spikes S1/S2).
 */
import { Connection } from '@solana/web3.js';
import { SOLANA_DEVNET_RPC, TEE_ER_ENDPOINT } from './constants';

export function baseConnection(): Connection {
  return new Connection(SOLANA_DEVNET_RPC, 'confirmed');
}

/** A Connection whose URL carries the TEE query-filtering token. */
export function teeConnection(
  token: string,
  endpoint = TEE_ER_ENDPOINT,
): Connection {
  return new Connection(`${endpoint}/?token=${token}`, 'confirmed');
}
