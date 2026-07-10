/**
 * validation.ts — zod schemas + a self-contained base58 pubkey check.
 *
 * We avoid pulling in a Solana dependency just to validate a string; a Solana
 * pubkey is 32 bytes, so we base58-decode and assert the byte length.
 */

import { z } from "zod";
import { Expo } from "expo-server-sdk";
import { NOTIFY_TYPES } from "./messages.js";

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Decode a base58 string to bytes, or null if it contains an invalid char. */
function base58Decode(input: string): Uint8Array | null {
  if (input.length === 0) return null;
  // Little-endian accumulator of the significant (non-leading-zero) bytes.
  const bytes: number[] = [];
  for (const char of input) {
    const value = BASE58_ALPHABET.indexOf(char);
    if (value === -1) return null;
    let carry = value;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  // Each leading '1' is exactly one leading zero byte.
  let leadingZeros = 0;
  for (let k = 0; k < input.length && input[k] === "1"; k++) leadingZeros++;

  const out = new Uint8Array(leadingZeros + bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    out[leadingZeros + i] = bytes[bytes.length - 1 - i];
  }
  return out;
}

/** True if `value` is a base58-encoded 32-byte Solana pubkey. */
export function isBase58Pubkey(value: string): boolean {
  const decoded = base58Decode(value);
  return decoded !== null && decoded.length === 32;
}

const walletSchema = z
  .string()
  .refine(isBase58Pubkey, { message: "wallet must be a base58 pubkey" });

const pushTokenSchema = z
  .string()
  .refine((t) => Expo.isExpoPushToken(t), {
    message: "pushToken must be an Expo push token",
  });

export const registerSchema = z.object({
  wallet: walletSchema,
  pushToken: pushTokenSchema,
});

export const notifySchema = z.object({
  targetWallet: walletSchema,
  type: z.enum(NOTIFY_TYPES),
  id: z.string().min(1),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type NotifyInput = z.infer<typeof notifySchema>;
