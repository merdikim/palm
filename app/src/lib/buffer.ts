/**
 * Buffer re-export.
 *
 * WHY: we import the `buffer` polyfill's `Buffer` (not the RN global) so that
 * top-level `Buffer.from(...)` calls in this dir — e.g. the seed constants in
 * vault.ts — evaluate correctly regardless of when index.ts assigns
 * `global.Buffer`. But `buffer@6.0.3` ships inaccurate type definitions
 * (`readBigUInt64LE` returns `BigInt` instead of `bigint`, `writeBigUInt64LE`
 * takes `number` instead of `bigint`, incomplete `from`/`subarray` overloads).
 *
 * So: keep the polyfill's runtime value, but type it as Node's accurate Buffer
 * (from @types/node). Import `Buffer` from here instead of from 'buffer'.
 */
import { Buffer as PolyfillBuffer } from 'buffer';

export const Buffer = PolyfillBuffer as unknown as typeof globalThis.Buffer;
export type Buffer = globalThis.Buffer;
