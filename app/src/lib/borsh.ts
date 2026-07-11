/**
 * Minimal Borsh reader/writer for the vault program's instruction args and
 * account layouts.
 *
 * WHY HAND-ROLLED: `@coral-xyz/anchor`'s runtime `Program`/`BorshCoder` pulls a
 * large dependency graph and historically fights the React Native bundler
 * (node builtins, `import.meta`, dynamic requires). We only need a handful of
 * fixed layouts, so we encode/decode them directly against the deployed
 * program's known discriminators (from the bundled IDL). This keeps the Metro
 * bundle small and deterministic. See app/README.md ("anchor decision").
 */
import { PublicKey } from '@solana/web3.js';
import { Buffer } from './buffer';

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------
export class BorshWriter {
  private chunks: Buffer[] = [];

  private push(b: Buffer): this {
    this.chunks.push(b);
    return this;
  }

  u8(v: number): this {
    const b = Buffer.alloc(1);
    b.writeUInt8(v & 0xff, 0);
    return this.push(b);
  }

  u16(v: number): this {
    const b = Buffer.alloc(2);
    b.writeUInt16LE(v, 0);
    return this.push(b);
  }

  u32(v: number): this {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(v >>> 0, 0);
    return this.push(b);
  }

  u64(v: bigint | number): this {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(BigInt(v), 0);
    return this.push(b);
  }

  i64(v: bigint | number): this {
    const b = Buffer.alloc(8);
    b.writeBigInt64LE(BigInt(v), 0);
    return this.push(b);
  }

  bool(v: boolean): this {
    return this.u8(v ? 1 : 0);
  }

  pubkey(pk: PublicKey): this {
    return this.push(Buffer.from(pk.toBytes()));
  }

  /** Fixed-length byte array (e.g. [u8; 32]). */
  fixedBytes(bytes: number[] | Uint8Array): this {
    return this.push(Buffer.from(bytes));
  }

  /** Borsh Option<T>: 0 => None, 1 + value => Some. */
  option<T>(v: T | null | undefined, write: (w: this, val: T) => void): this {
    if (v === null || v === undefined) return this.u8(0);
    this.u8(1);
    write(this, v);
    return this;
  }

  /** Borsh Vec<T>: u32 length prefix + elements. */
  vec<T>(items: T[], write: (w: this, val: T) => void): this {
    this.u32(items.length);
    for (const it of items) write(this, it);
    return this;
  }

  toBuffer(): Buffer {
    return Buffer.concat(this.chunks);
  }
}

// ---------------------------------------------------------------------------
// Reader
// ---------------------------------------------------------------------------
export class BorshReader {
  offset = 0;
  constructor(private buf: Buffer) {}

  u8(): number {
    const v = this.buf.readUInt8(this.offset);
    this.offset += 1;
    return v;
  }

  u16(): number {
    const v = this.buf.readUInt16LE(this.offset);
    this.offset += 2;
    return v;
  }

  u32(): number {
    const v = this.buf.readUInt32LE(this.offset);
    this.offset += 4;
    return v;
  }

  u64(): bigint {
    const v = this.buf.readBigUInt64LE(this.offset);
    this.offset += 8;
    return v;
  }

  i64(): bigint {
    const v = this.buf.readBigInt64LE(this.offset);
    this.offset += 8;
    return v;
  }

  bool(): boolean {
    return this.u8() === 1;
  }

  pubkey(): PublicKey {
    const slice = this.buf.subarray(this.offset, this.offset + 32);
    this.offset += 32;
    return new PublicKey(slice);
  }

  fixedBytes(n: number): Buffer {
    const slice = this.buf.subarray(this.offset, this.offset + n);
    this.offset += n;
    return Buffer.from(slice);
  }

  option<T>(read: (r: this) => T): T | null {
    return this.u8() === 1 ? read(this) : null;
  }

  vec<T>(read: (r: this) => T): T[] {
    const len = this.u32();
    const out: T[] = [];
    for (let i = 0; i < len; i++) out.push(read(this));
    return out;
  }

  /** Skip the leading 8-byte Anchor account discriminator. */
  skipDiscriminator(): this {
    this.offset += 8;
    return this;
  }
}
