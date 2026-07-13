import {
  PublicKey,
  Transaction,
  VersionedTransaction,
} from '@solana/web3.js';

export interface Signer {
  readonly publicKey: PublicKey;
  signMessage(message: Uint8Array): Promise<Uint8Array>;
  /**
   * Returns a NEW signed transaction — `tx` is NOT signed in place. The MWA
   * wallet round-trips the tx over the protocol and hands back a freshly
   * deserialized object, so the argument still has empty signatures afterwards.
   * Always submit the RETURN VALUE: `(await signTransaction(tx)).serialize()`.
   * Serializing `tx` instead throws "Missing signature for public key".
   */
  signTransaction<T extends Transaction | VersionedTransaction>(
    tx: T,
  ): Promise<T>;
}
