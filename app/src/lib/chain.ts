/**
 * chain.ts — submit locally-built base-layer transactions via the Signer.
 *
 * Used for the vault program's owner-signed instructions (create_vault,
 * reclaim, update_policy) which live on the Solana mainnet base layer. ER-native
 * instructions go through `tee.submitTeeTxObject` instead.
 */
import { Transaction, type TransactionInstruction } from '@solana/web3.js';
import { baseConnection } from './connections';
import type { Signer } from './signer';

/** Assemble, sign, submit, and confirm a base-layer transaction. */
export async function sendBaseTx(
  ixs: TransactionInstruction[],
  signer: Signer,
): Promise<string> {
  const conn = baseConnection();
  const { blockhash, lastValidBlockHeight } =
    await conn.getLatestBlockhash('confirmed');
  const tx = new Transaction();
  tx.add(...ixs);
  tx.recentBlockhash = blockhash;
  tx.feePayer = signer.publicKey;
  const signed = await signer.signTransaction(tx);
  const sig = await conn.sendRawTransaction(signed.serialize(), {
    skipPreflight: true,
  });
  const conf = await conn.confirmTransaction(
    { signature: sig, blockhash, lastValidBlockHeight },
    'confirmed',
  );
  if (conf.value.err) {
    throw new Error(
      `tx ${sig} failed on-chain: ${JSON.stringify(conf.value.err)}`,
    );
  }
  return sig;
}

/** Request a SOL airdrop (rent/fees). NOTE: airdrops are not available on
 *  mainnet — this helper is test/devnet-only and is currently unused. */
export async function requestAirdrop(
  signer: Signer,
  lamports = 1_000_000_000,
): Promise<string> {
  const conn = baseConnection();
  const sig = await conn.requestAirdrop(signer.publicKey, lamports);
  await conn.confirmTransaction(sig, 'confirmed');
  return sig;
}
