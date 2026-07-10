/**
 * Client for the vault program (per-agent escrow vaults), RN-adapted from
 * `shared/vault.ts`.
 *
 * Instead of the Anchor runtime `Program`, this builds raw
 * `TransactionInstruction`s and decodes account data via the small Borsh helper
 * in `./borsh`. PDA/ATA derivations, account ordering, arg encoding, and the
 * instruction discriminators all mirror the bundled IDL (`src/idl/vault.json`).
 */
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
import { Buffer } from 'buffer';
import { VAULT_PROGRAM_ID } from './constants';
import { BorshWriter, BorshReader } from './borsh';

export const PROGRAM_ID = new PublicKey(VAULT_PROGRAM_ID);
export const VAULT_SEED = Buffer.from('vault');
export const REQUEST_SEED = Buffer.from('request');
export const COUNTER_SEED = Buffer.from('req_counter');

// Instruction discriminators (from IDL).
const IX = {
  createVault: [29, 237, 247, 208, 193, 82, 54, 135],
  agentPay: [191, 210, 112, 56, 82, 215, 140, 233],
  reclaim: [44, 177, 236, 249, 145, 109, 163, 186],
  updatePolicy: [212, 245, 246, 7, 163, 151, 18, 57],
  createRequest: [219, 191, 93, 237, 18, 44, 42, 84],
  requestAgentApproval: [131, 228, 36, 178, 192, 254, 133, 85],
  respondRequest: [37, 78, 107, 16, 167, 160, 154, 207],
} as const;

// Account discriminators (from IDL).
const ACCT = {
  agentVault: [232, 220, 237, 164, 157, 9, 215, 194],
  paymentRequest: [27, 20, 202, 96, 101, 242, 124, 69],
  requestCounter: [220, 43, 83, 73, 39, 210, 63, 108],
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
export function counterPda(payer: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [COUNTER_SEED, payer.toBuffer()],
    PROGRAM_ID,
  );
}
export function requestPda(
  payer: PublicKey,
  requestId: bigint | number,
): [PublicKey, number] {
  const idBuf = Buffer.alloc(8);
  idBuf.writeBigUInt64LE(BigInt(requestId));
  return PublicKey.findProgramAddressSync(
    [REQUEST_SEED, payer.toBuffer(), idBuf],
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

export function createRequestIx(
  requester: PublicKey,
  payer: PublicKey,
  mintOut: PublicKey,
  amountOut: bigint,
  expiresAt: bigint,
  memoHash: number[],
): TransactionInstruction {
  const [counter] = counterPda(payer);
  const [request] = requestPda(payer, 0); // NOTE: request PDA uses counter.next_id.
  const w = new BorshWriter();
  w.pubkey(payer).pubkey(mintOut).u64(amountOut).i64(expiresAt).fixedBytes(memoHash);
  const data = Buffer.concat([disc(IX.createRequest), w.toBuffer()]);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: requester, isSigner: true, isWritable: true },
      { pubkey: counter, isSigner: false, isWritable: true },
      { pubkey: request, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

/**
 * Build `create_request` with an explicit next request id (the payer's current
 * `counter.next_id`), so the `request` PDA seed matches the on-chain expectation.
 * Prefer this over `createRequestIx` when the counter value is known.
 */
export function createRequestIxWithId(
  requester: PublicKey,
  payer: PublicKey,
  nextId: bigint,
  mintOut: PublicKey,
  amountOut: bigint,
  expiresAt: bigint,
  memoHash: number[],
): TransactionInstruction {
  const [counter] = counterPda(payer);
  const [request] = requestPda(payer, nextId);
  const w = new BorshWriter();
  w.pubkey(payer).pubkey(mintOut).u64(amountOut).i64(expiresAt).fixedBytes(memoHash);
  const data = Buffer.concat([disc(IX.createRequest), w.toBuffer()]);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: requester, isSigner: true, isWritable: true },
      { pubkey: counter, isSigner: false, isWritable: true },
      { pubkey: request, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

export function requestAgentApprovalIx(
  owner: PublicKey,
  agent: PublicKey,
  funder: PublicKey,
  nextId: bigint,
  mintOut: PublicKey,
  amountOut: bigint,
  quote: Quote,
  expiresAt: bigint,
  memoHash: number[],
): TransactionInstruction {
  const [vault] = vaultPda(owner, agent);
  const [counter] = counterPda(owner);
  const [request] = requestPda(owner, nextId);
  const w = new BorshWriter();
  w.pubkey(mintOut).u64(amountOut);
  writeQuote(w, quote);
  w.i64(expiresAt).fixedBytes(memoHash);
  const data = Buffer.concat([disc(IX.requestAgentApproval), w.toBuffer()]);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: agent, isSigner: true, isWritable: false },
      { pubkey: funder, isSigner: true, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: false },
      { pubkey: counter, isSigner: false, isWritable: true },
      { pubkey: request, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

export function respondRequestIx(
  payer: PublicKey,
  requestId: bigint,
  accept: boolean,
  quote: Quote,
  opts: {
    payerSource?: PublicKey | null;
    vault?: PublicKey | null;
    vaultUsdc?: PublicKey | null;
    destUsdc?: PublicKey | null;
  } = {},
): TransactionInstruction {
  const [request] = requestPda(payer, requestId);
  const w = new BorshWriter();
  w.bool(accept);
  writeQuote(w, quote);
  const data = Buffer.concat([disc(IX.respondRequest), w.toBuffer()]);
  // Anchor optional accounts: pass the program id as the placeholder when absent.
  const optional = (pk: PublicKey | null | undefined) =>
    pk ?? PROGRAM_ID;
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: false },
      { pubkey: request, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: optional(opts.payerSource), isSigner: false, isWritable: !!opts.payerSource },
      { pubkey: optional(opts.vault), isSigner: false, isWritable: !!opts.vault },
      { pubkey: optional(opts.vaultUsdc), isSigner: false, isWritable: !!opts.vaultUsdc },
      { pubkey: optional(opts.destUsdc), isSigner: false, isWritable: !!opts.destUsdc },
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

export type RequestStatus = 'Pending' | 'Accepted' | 'Denied' | 'Expired';

export interface PaymentRequest {
  requester: PublicKey;
  payer: PublicKey;
  vault: PublicKey | null;
  mintOut: PublicKey;
  amountOut: bigint;
  memoHash: Buffer;
  status: RequestStatus;
  createdAt: bigint;
  expiresAt: bigint;
  requestId: bigint;
  bump: number;
}

export interface RequestCounter {
  payer: PublicKey;
  nextId: bigint;
  bump: number;
}

const STATUS: RequestStatus[] = ['Pending', 'Accepted', 'Denied', 'Expired'];

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

export function decodePaymentRequest(data: Buffer): PaymentRequest {
  const r = new BorshReader(data).skipDiscriminator();
  return {
    requester: r.pubkey(),
    payer: r.pubkey(),
    vault: r.option((rr) => rr.pubkey()),
    mintOut: r.pubkey(),
    amountOut: r.u64(),
    memoHash: r.fixedBytes(32),
    status: STATUS[r.u8()] ?? 'Pending',
    createdAt: r.i64(),
    expiresAt: r.i64(),
    requestId: r.u64(),
    bump: r.u8(),
  };
}

export function decodeRequestCounter(data: Buffer): RequestCounter {
  const r = new BorshReader(data).skipDiscriminator();
  return {
    payer: r.pubkey(),
    nextId: r.u64(),
    bump: r.u8(),
  };
}

export function isAgentVault(data: Buffer): boolean {
  return data.length >= 8 && Buffer.from(ACCT.agentVault).equals(data.subarray(0, 8));
}
export function isPaymentRequest(data: Buffer): boolean {
  return data.length >= 8 && Buffer.from(ACCT.paymentRequest).equals(data.subarray(0, 8));
}
export function isRequestCounter(data: Buffer): boolean {
  return data.length >= 8 && Buffer.from(ACCT.requestCounter).equals(data.subarray(0, 8));
}
