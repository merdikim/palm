import {
  PublicKey,
  Transaction,
  VersionedTransaction,
} from '@solana/web3.js';

export interface Signer {
  readonly publicKey: PublicKey;
  signMessage(message: Uint8Array): Promise<Uint8Array>;
  signTransaction<T extends Transaction | VersionedTransaction>(
    tx: T,
  ): Promise<T>;
}
