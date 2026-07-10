/**
 * Client for the vault program (per-agent escrow vaults).
 *
 * Thin wrapper over the Anchor program: PDA derivation + typed instruction
 * builders. Used by the program tests, e2e scenarios, and the mobile app.
 */
import { readFileSync } from "node:fs";
import {
  AnchorProvider,
  Program,
  BN,
  Wallet,
  type Idl,
} from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { VAULT_PROGRAM_ID } from "./constants.js";

export const VAULT_SEED = Buffer.from("vault");
export const REQUEST_SEED = Buffer.from("request");
export const COUNTER_SEED = Buffer.from("req_counter");
export const PROGRAM_ID = new PublicKey(VAULT_PROGRAM_ID);

export function loadIdl(): Idl {
  const url = new URL("./idl/vault.json", import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")) as Idl;
}

export function makeProgram(connection: Connection, payer: Keypair): Program {
  const provider = new AnchorProvider(connection, new Wallet(payer), {
    commitment: "confirmed",
    skipPreflight: false,
  });
  return new Program(loadIdl(), provider);
}

// ---- PDA derivations ----
export function vaultPda(owner: PublicKey, agent: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [VAULT_SEED, owner.toBuffer(), agent.toBuffer()],
    PROGRAM_ID,
  );
}
export function counterPda(payer: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([COUNTER_SEED, payer.toBuffer()], PROGRAM_ID);
}
export function requestPda(payer: PublicKey, requestId: bigint | number): [PublicKey, number] {
  const idBuf = Buffer.alloc(8);
  idBuf.writeBigUInt64LE(BigInt(requestId));
  return PublicKey.findProgramAddressSync([REQUEST_SEED, payer.toBuffer(), idBuf], PROGRAM_ID);
}
export function vaultAta(vault: PublicKey, mint: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(mint, vault, true);
}

// ---- Policy shape (matches on-chain VaultPolicy) ----
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

const bn = (v: bigint | number) => new BN(v.toString());
function policyArg(p: Policy) {
  return {
    maxPerTx: bn(p.maxPerTx),
    maxSlippageBps: p.maxSlippageBps,
    dailyLimit: p.dailyLimit == null ? null : bn(p.dailyLimit),
    merchantAllowlist: p.merchantAllowlist,
    approvalThreshold: p.approvalThreshold == null ? null : bn(p.approvalThreshold),
    expiry: p.expiry == null ? null : bn(p.expiry),
  };
}
const quoteArg = (q: Quote) => ({ usdcDebit: bn(q.usdcDebit), quotedSlippageBps: q.quotedSlippageBps });

// ---- Instruction builders (return the anchor MethodsBuilder) ----
export function createVaultIx(
  program: Program, owner: PublicKey, agent: PublicKey, usdcMint: PublicKey, policy: Policy,
) {
  const [vault] = vaultPda(owner, agent);
  return program.methods.createVault(policyArg(policy)).accounts({
    owner, agent, vault, usdcMint,
    vaultUsdc: vaultAta(vault, usdcMint),
    tokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  });
}

export function agentPayIx(
  program: Program, owner: PublicKey, agent: PublicKey, usdcMint: PublicKey,
  merchantUsdc: PublicKey, mintOut: PublicKey, amountOut: bigint, quote: Quote,
) {
  const [vault] = vaultPda(owner, agent);
  return program.methods.agentPay(mintOut, bn(amountOut), quoteArg(quote)).accounts({
    agent, vault, usdcMint, vaultUsdc: vaultAta(vault, usdcMint), merchantUsdc,
    tokenProgram: TOKEN_PROGRAM_ID,
  });
}

export function reclaimIx(
  program: Program, owner: PublicKey, agent: PublicKey, usdcMint: PublicKey,
  ownerUsdc: PublicKey, amount: bigint | null, close: boolean,
) {
  const [vault] = vaultPda(owner, agent);
  return program.methods.reclaim(amount == null ? null : bn(amount), close).accounts({
    owner, vault, usdcMint, vaultUsdc: vaultAta(vault, usdcMint), ownerUsdc,
    tokenProgram: TOKEN_PROGRAM_ID,
  });
}

export function updatePolicyIx(program: Program, owner: PublicKey, agent: PublicKey, policy: Policy) {
  const [vault] = vaultPda(owner, agent);
  return program.methods.updatePolicy(policyArg(policy)).accounts({ owner, vault });
}

export function createRequestIx(
  program: Program, requester: PublicKey, payer: PublicKey, nextId: bigint,
  mintOut: PublicKey, amountOut: bigint, expiresAt: bigint, memoHash: number[],
) {
  const [counter] = counterPda(payer);
  const [request] = requestPda(payer, nextId);
  return program.methods
    .createRequest(payer, mintOut, bn(amountOut), bn(expiresAt), memoHash)
    .accounts({ requester, counter, request, systemProgram: SystemProgram.programId });
}

export function requestAgentApprovalIx(
  program: Program, owner: PublicKey, agent: PublicKey, nextId: bigint,
  mintOut: PublicKey, amountOut: bigint, quote: Quote, expiresAt: bigint, memoHash: number[],
  funder: PublicKey,
) {
  const [vault] = vaultPda(owner, agent);
  const [counter] = counterPda(owner);
  const [request] = requestPda(owner, nextId);
  return program.methods
    .requestAgentApproval(mintOut, bn(amountOut), quoteArg(quote), bn(expiresAt), memoHash)
    .accounts({ agent, funder, vault, counter, request, systemProgram: SystemProgram.programId });
}

export function respondRequestIx(
  program: Program, payer: PublicKey, requestId: bigint, accept: boolean, quote: Quote,
  opts: {
    payerSource?: PublicKey | null;
    vault?: PublicKey | null;
    vaultUsdc?: PublicKey | null;
    destUsdc?: PublicKey | null;
  },
) {
  const [request] = requestPda(payer, requestId);
  return program.methods.respondRequest(accept, quoteArg(quote)).accounts({
    payer, request, tokenProgram: TOKEN_PROGRAM_ID,
    payerSource: opts.payerSource ?? null,
    vault: opts.vault ?? null,
    vaultUsdc: opts.vaultUsdc ?? null,
    destUsdc: opts.destUsdc ?? null,
  });
}

// ---- Account fetch helpers ----
export async function fetchVault(program: Program, owner: PublicKey, agent: PublicKey) {
  const [vault] = vaultPda(owner, agent);
  return program.account.agentVault.fetch(vault);
}
export async function fetchRequest(program: Program, payer: PublicKey, requestId: bigint) {
  const [request] = requestPda(payer, requestId);
  return program.account.paymentRequest.fetch(request);
}
