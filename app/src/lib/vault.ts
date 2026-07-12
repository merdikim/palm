/**
 * Client for the vault program (per-agent escrow vaults), RN-adapted from
 * `shared/vault.ts`.
 *
 * Instead of the Anchor runtime `Program`, this builds raw
 * `TransactionInstruction`s and decodes account data via the small Borsh helper
 * in `./borsh`. PDA/ATA derivations, account ordering, arg encoding, and the
 * instruction discriminators all mirror the bundled IDL (`src/idl/vault.json`).
 */
import { Buffer } from './buffer';
import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { VAULT_PROGRAM_ID } from './constants';
import { BorshWriter, BorshReader } from './borsh';

export const PROGRAM_ID = new PublicKey(VAULT_PROGRAM_ID);
export const VAULT_SEED = Buffer.from('vault');

// Instruction discriminators (from IDL).
const IX = {
  createVault: [29, 237, 247, 208, 193, 82, 54, 135],
  agentPay: [191, 210, 112, 56, 82, 215, 140, 233],
  reclaim: [44, 177, 236, 249, 145, 109, 163, 186],
  updatePolicy: [212, 245, 246, 7, 163, 151, 18, 57],
} as const;

// Account discriminators (from IDL).
const ACCT = {
  agentVault: [232, 220, 237, 164, 157, 9, 215, 194],
} as const;

const disc = (d: readonly number[]) => Buffer.from(d);

// ---------------------------------------------------------------------------
// PDA / ATA derivations
// ---------------------------------------------------------------------------
export function vaultPda(owner: PublicKey, agent: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [VAULT_SEED, owner.toBuffer(), agent.toBuffer()],
    PROGRAM_ID,
  );
}
export function vaultAta(vault: PublicKey, mint: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(mint, vault, true);
}

// ---------------------------------------------------------------------------
// Policy / quote shapes (match on-chain VaultPolicy / QuoteContext)
// ---------------------------------------------------------------------------
export interface Policy {
  maxPerTx: bigint;
  maxSlippageBps: number;
  dailyLimit: bigint | null;
  merchantAllowlist: PublicKey[] | null;
  approvalThreshold: bigint | null;
  expiry: bigint | null;
}
export interface Quote {
  usdcDebit: bigint;
  quotedSlippageBps: number;
}

function writePolicy(w: BorshWriter, p: Policy): void {
  w.u64(p.maxPerTx);
  w.u16(p.maxSlippageBps);
  w.option(p.dailyLimit, (ww, v) => ww.u64(v));
  w.option(p.merchantAllowlist, (ww, list) =>
    ww.vec(list, (w2, pk) => w2.pubkey(pk)),
  );
  w.option(p.approvalThreshold, (ww, v) => ww.u64(v));
  w.option(p.expiry, (ww, v) => ww.i64(v));
}
function writeQuote(w: BorshWriter, q: Quote): void {
  w.u64(q.usdcDebit);
  w.u16(q.quotedSlippageBps);
}

// ---------------------------------------------------------------------------
// Instruction builders
// ---------------------------------------------------------------------------
export function createVaultIx(
  owner: PublicKey,
  agent: PublicKey,
  usdcMint: PublicKey,
  policy: Policy,
): TransactionInstruction {
  const [vault] = vaultPda(owner, agent);
  const data = Buffer.concat([
    disc(IX.createVault),
    (() => {
      const w = new BorshWriter();
      writePolicy(w, policy);
      return w.toBuffer();
    })(),
  ]);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: agent, isSigner: false, isWritable: false },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: usdcMint, isSigner: false, isWritable: false },
      { pubkey: vaultAta(vault, usdcMint), isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

export function agentPayIx(
  owner: PublicKey,
  agent: PublicKey,
  usdcMint: PublicKey,
  merchantUsdc: PublicKey,
  mintOut: PublicKey,
  amountOut: bigint,
  quote: Quote,
): TransactionInstruction {
  const [vault] = vaultPda(owner, agent);
  const w = new BorshWriter();
  w.pubkey(mintOut).u64(amountOut);
  writeQuote(w, quote);
  const data = Buffer.concat([disc(IX.agentPay), w.toBuffer()]);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: agent, isSigner: true, isWritable: false },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: usdcMint, isSigner: false, isWritable: false },
      { pubkey: vaultAta(vault, usdcMint), isSigner: false, isWritable: true },
      { pubkey: merchantUsdc, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  });
}

export function reclaimIx(
  owner: PublicKey,
  agent: PublicKey,
  usdcMint: PublicKey,
  ownerUsdc: PublicKey,
  amount: bigint | null,
  close: boolean,
): TransactionInstruction {
  const [vault] = vaultPda(owner, agent);
  const w = new BorshWriter();
  w.option(amount, (ww, v) => ww.u64(v));
  w.bool(close);
  const data = Buffer.concat([disc(IX.reclaim), w.toBuffer()]);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: usdcMint, isSigner: false, isWritable: false },
      { pubkey: vaultAta(vault, usdcMint), isSigner: false, isWritable: true },
      { pubkey: ownerUsdc, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  });
}

export function updatePolicyIx(
  owner: PublicKey,
  agent: PublicKey,
  policy: Policy,
): TransactionInstruction {
  const [vault] = vaultPda(owner, agent);
  const w = new BorshWriter();
  writePolicy(w, policy);
  const data = Buffer.concat([disc(IX.updatePolicy), w.toBuffer()]);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: false },
      { pubkey: vault, isSigner: false, isWritable: true },
    ],
    data,
  });
}

// ---------------------------------------------------------------------------
// Account decoders
// ---------------------------------------------------------------------------
export interface AgentVault {
  owner: PublicKey;
  agent: PublicKey;
  bump: number;
  expiry: bigint | null;
  maxPerTx: bigint;
  maxSlippageBps: number;
  dailyLimit: bigint | null;
  spentToday: bigint;
  windowStart: bigint;
  merchantAllowlist: PublicKey[] | null;
  approvalThreshold: bigint | null;
  lifetimeSpent: bigint;
  paymentCount: number;
}

export function decodeAgentVault(data: Buffer): AgentVault {
  const r = new BorshReader(data).skipDiscriminator();
  return {
    owner: r.pubkey(),
    agent: r.pubkey(),
    bump: r.u8(),
    expiry: r.option((rr) => rr.i64()),
    maxPerTx: r.u64(),
    maxSlippageBps: r.u16(),
    dailyLimit: r.option((rr) => rr.u64()),
    spentToday: r.u64(),
    windowStart: r.i64(),
    merchantAllowlist: r.option((rr) => rr.vec((r2) => r2.pubkey())),
    approvalThreshold: r.option((rr) => rr.u64()),
    lifetimeSpent: r.u64(),
    paymentCount: r.u32(),
  };
}

export function isAgentVault(data: Buffer): boolean {
  return data.length >= 8 && Buffer.from(ACCT.agentVault).equals(data.subarray(0, 8));
}
