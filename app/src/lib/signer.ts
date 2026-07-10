/**
 * Signer abstraction.
 *
 * The app never assumes a raw local keypair beyond this interface, so a Mobile
 * Wallet Adapter session or an embedded/MPC wallet can be dropped in later
 * without touching call sites. Today's implementation is `LocalKeypairSigner`:
 * a locally-generated ed25519 keypair whose secret key is held in
 * `expo-secure-store`.
 */
import * as SecureStore from 'expo-secure-store';
import {
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

export interface Signer {
  readonly publicKey: PublicKey;
  /** Detached ed25519 signature over arbitrary bytes (auth challenges). */
  signMessage(message: Uint8Array): Promise<Uint8Array>;
  /** Sign (partial) a legacy or versioned transaction and return it. */
  signTransaction<T extends Transaction | VersionedTransaction>(
    tx: T,
  ): Promise<T>;
}

const SECRET_KEY_STORE = 'palm.wallet.secretKey.v1';

/** Local ed25519 keypair signer backed by expo-secure-store. */
export class LocalKeypairSigner implements Signer {
  private constructor(private readonly keypair: Keypair) {}

  get publicKey(): PublicKey {
    return this.keypair.publicKey;
  }

  /** Expose the raw keypair only for web3 helpers that need a `Signer`-like. */
  get raw(): Keypair {
    return this.keypair;
  }

  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    return nacl.sign.detached(message, this.keypair.secretKey);
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(
    tx: T,
  ): Promise<T> {
    if (tx instanceof VersionedTransaction) {
      tx.sign([this.keypair]);
    } else {
      tx.partialSign(this.keypair);
    }
    return tx;
  }

  // --- persistence ---------------------------------------------------------

  /** Load an existing signer from secure storage, or null if none exists. */
  static async load(): Promise<LocalKeypairSigner | null> {
    const stored = await SecureStore.getItemAsync(SECRET_KEY_STORE);
    if (!stored) return null;
    const secret = bs58.decode(stored);
    return new LocalKeypairSigner(Keypair.fromSecretKey(secret));
  }

  /** Generate a fresh keypair and persist its secret key. */
  static async create(): Promise<LocalKeypairSigner> {
    const kp = Keypair.generate();
    await SecureStore.setItemAsync(SECRET_KEY_STORE, bs58.encode(kp.secretKey));
    return new LocalKeypairSigner(kp);
  }

  /** Import from a base58-encoded 64-byte secret key and persist it. */
  static async importFromBase58(secretBase58: string): Promise<LocalKeypairSigner> {
    const secret = bs58.decode(secretBase58.trim());
    const kp = Keypair.fromSecretKey(secret); // throws on bad length
    await SecureStore.setItemAsync(SECRET_KEY_STORE, bs58.encode(kp.secretKey));
    return new LocalKeypairSigner(kp);
  }

  /** Export the secret key (base58) — used only for local backup UX. */
  exportSecretBase58(): string {
    return bs58.encode(this.keypair.secretKey);
  }

  /** Wipe the stored key (danger — irrecoverable). */
  static async wipe(): Promise<void> {
    await SecureStore.deleteItemAsync(SECRET_KEY_STORE);
  }
}
