/**
 * actions.ts — high-level flows the screens call. Each returns real devnet
 * results where the contract is settled, and is annotated where a leg is
 * best-effort / stubbed (swap on devnet, vault top-up onto the ER).
 */
import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { Buffer } from 'buffer';
import { USDC_DEVNET } from './constants';
import type { Signer } from './signer';
import { getTeeToken } from './session';
import { teeConnection, baseConnection } from './connections';
import {
  buildDeposit,
  buildWithdraw,
  buildTransfer,
  signAndSend,
} from './payments';
import { readTeeBalance, submitTeeTxObject } from './tee';
import { sendBaseTx } from './chain';
import { usdcBase } from './format';
import {
  createVaultIx,
  updatePolicyIx,
  reclaimIx,
  vaultPda,
  vaultAta,
  counterPda,
  requestPda,
  createRequestIxWithId,
  respondRequestIx,
  decodeAgentVault,
  decodePaymentRequest,
  decodeRequestCounter,
  type AgentVault,
  type PaymentRequest,
  type Policy,
} from './vault';
import { directQuote } from './swap';
import { memoHash } from './onboarding';
import {
  addVaultEntry,
  removeVaultEntry,
  listVaultEntries,
  addRequestEntry,
  listRequestEntries,
  type RequestEntry,
} from './registry';
import { Transaction } from '@solana/web3.js';

const USDC = new PublicKey(USDC_DEVNET);

// ---------------------------------------------------------------------------
// Balance (TEE-native private read)
// ---------------------------------------------------------------------------
export async function getPrivateBalance(signer: Signer): Promise<bigint> {
  const token = await getTeeToken(signer);
  return readTeeBalance(signer.publicKey, USDC, token);
}

// ---------------------------------------------------------------------------
// Deposit / withdraw / private transfer (hosted API builds, we sign+submit)
// ---------------------------------------------------------------------------
export async function deposit(signer: Signer, dollars: number): Promise<string> {
  const built = await buildDeposit({
    owner: signer.publicKey.toBase58(),
    amount: dollars,
  });
  const token = built.sendTo === 'ephemeral' ? await getTeeToken(signer) : undefined;
  return signAndSend(built, signer, token);
}

export async function withdraw(signer: Signer, dollars: number): Promise<string> {
  const built = await buildWithdraw({
    owner: signer.publicKey.toBase58(),
    amount: dollars,
  });
  const token = built.sendTo === 'ephemeral' ? await getTeeToken(signer) : undefined;
  return signAndSend(built, signer, token);
}

export async function privateTransfer(
  signer: Signer,
  to: string,
  dollars: number,
  memo?: string,
): Promise<string> {
  const token = await getTeeToken(signer);
  const built = await buildTransfer(
    {
      from: signer.publicKey.toBase58(),
      to,
      amount: dollars,
      visibility: 'private',
      fromBalance: 'ephemeral',
      toBalance: 'ephemeral',
      memo,
    },
    token,
  );
  return signAndSend(built, signer, token);
}

// ---------------------------------------------------------------------------
// Vaults (base-layer program instructions, owner-signed)
// ---------------------------------------------------------------------------
export async function createVault(
  signer: Signer,
  agent: PublicKey,
  policy: Policy,
  label?: string,
): Promise<string> {
  const ix = createVaultIx(signer.publicKey, agent, USDC, policy);
  const sig = await sendBaseTx([ix], signer);
  await addVaultEntry({
    agent: agent.toBase58(),
    label,
    createdAt: Date.now(),
  });
  return sig;
}

export async function updateVaultPolicy(
  signer: Signer,
  agent: PublicKey,
  policy: Policy,
): Promise<string> {
  return sendBaseTx([updatePolicyIx(signer.publicKey, agent, policy)], signer);
}

/** Reclaim all funds and close the vault (revoke). */
export async function revokeVault(
  signer: Signer,
  agent: PublicKey,
): Promise<string> {
  const ownerUsdc = getAssociatedTokenAddressSync(USDC, signer.publicKey, true);
  const ix = reclaimIx(signer.publicKey, agent, USDC, ownerUsdc, null, true);
  const sig = await sendBaseTx([ix], signer);
  await removeVaultEntry(agent.toBase58());
  return sig;
}

/**
 * Top up a vault's allowance. BEST-EFFORT on devnet: funds the vault PDA's
 * private balance via a hosted private transfer to the vault address. The vault
 * ATA must be onboarded/delegated on the ER to receive (spikes S2#7).
 */
export async function topUpVault(
  signer: Signer,
  agent: PublicKey,
  dollars: number,
): Promise<string> {
  const [vault] = vaultPda(signer.publicKey, agent);
  const token = await getTeeToken(signer);
  const built = await buildTransfer(
    {
      from: signer.publicKey.toBase58(),
      to: vault.toBase58(),
      amount: dollars,
      visibility: 'private',
      fromBalance: 'ephemeral',
      toBalance: 'ephemeral',
    },
    token,
  );
  return signAndSend(built, signer, token);
}

export interface VaultView {
  agent: string;
  label?: string;
  account: AgentVault | null; // null if not yet on-chain / not found
  remainingAllowance: bigint; // vault USDC balance (ER read)
}

/** Load an AgentVault account (base) + its private balance (ER). */
export async function fetchVaultView(
  signer: Signer,
  entry: { agent: string; label?: string },
): Promise<VaultView> {
  const agent = new PublicKey(entry.agent);
  const [vault] = vaultPda(signer.publicKey, agent);
  const base = baseConnection();
  const info = await base.getAccountInfo(vault);
  const account = info ? decodeAgentVault(Buffer.from(info.data)) : null;

  let remainingAllowance = 0n;
  try {
    const token = await getTeeToken(signer);
    const ata = vaultAta(vault, USDC);
    const conn = teeConnection(token);
    const bal = await conn.getAccountInfo(ata);
    if (bal && bal.data.length >= 72) {
      remainingAllowance = Buffer.from(bal.data).readBigUInt64LE(64);
    }
  } catch {
    remainingAllowance = 0n;
  }
  return { agent: entry.agent, label: entry.label, account, remainingAllowance };
}

export async function fetchAllVaults(signer: Signer): Promise<VaultView[]> {
  const entries = await listVaultEntries();
  return Promise.all(entries.map((e) => fetchVaultView(signer, e)));
}

// ---------------------------------------------------------------------------
// Requests (created directly on the ER; deterministic counter derivation S4)
// ---------------------------------------------------------------------------

/** Read a payer's request counter next_id from the ER (0 if none yet). */
export async function readNextRequestId(
  signer: Signer,
  payer: PublicKey,
): Promise<bigint> {
  const token = await getTeeToken(signer);
  const conn = teeConnection(token);
  const [counter] = counterPda(payer);
  const info = await conn.getAccountInfo(counter);
  if (!info) return 0n;
  return decodeRequestCounter(Buffer.from(info.data)).nextId;
}

/**
 * Create a user-to-user request-to-pay. The requester (this user) asks `payer`
 * to pay `dollars`. Submitted to the ER. Records the id locally for discovery.
 */
export async function createRequest(
  signer: Signer,
  payer: PublicKey,
  dollars: number,
  memo = '',
  ttlSeconds = 60 * 60 * 24,
): Promise<{ signature: string; requestId: bigint }> {
  const token = await getTeeToken(signer);
  const nextId = await readNextRequestId(signer, payer);
  const expiresAt = BigInt(Math.floor(Date.now() / 1000) + ttlSeconds);
  const ix = createRequestIxWithId(
    signer.publicKey,
    payer,
    nextId,
    USDC,
    usdcBase(dollars),
    expiresAt,
    memoHash(memo),
  );
  const tx = new Transaction().add(ix);
  const signature = await submitTeeTxObject(tx, signer, token);
  await addRequestEntry({
    payer: payer.toBase58(),
    requestId: nextId.toString(),
    direction: 'from_me',
    createdAt: Date.now(),
  });
  return { signature, requestId: nextId };
}

/**
 * Respond to a user-to-user request as the payer. On accept, funds move from
 * the payer's own token account to the requester (payer signs as authority).
 */
export async function respondToRequest(
  signer: Signer,
  requestId: bigint,
  accept: boolean,
  req: PaymentRequest,
): Promise<string> {
  const token = await getTeeToken(signer);
  const payerSource = accept
    ? getAssociatedTokenAddressSync(USDC, signer.publicKey, true)
    : null;
  const destUsdc = accept
    ? getAssociatedTokenAddressSync(new PublicKey(req.mintOut), req.requester, true)
    : null;
  const ix = respondRequestIx(
    signer.publicKey,
    requestId,
    accept,
    directQuote(req.amountOut),
    { payerSource, destUsdc },
  );
  const tx = new Transaction().add(ix);
  return submitTeeTxObject(tx, signer, token);
}

export interface RequestView {
  entry: RequestEntry;
  account: PaymentRequest | null;
}

/** Fetch a single request account from the ER by (payer, id). */
export async function fetchRequest(
  signer: Signer,
  payer: PublicKey,
  requestId: bigint,
): Promise<PaymentRequest | null> {
  const token = await getTeeToken(signer);
  const conn = teeConnection(token);
  const [request] = requestPda(payer, requestId);
  const info = await conn.getAccountInfo(request);
  return info ? decodePaymentRequest(Buffer.from(info.data)) : null;
}

/** Load all locally-known requests + any addressed to me (derived by counter). */
export async function fetchAllRequests(signer: Signer): Promise<RequestView[]> {
  const entries = await listRequestEntries();
  // Also derive requests where I am the payer (addressed to me): scan my counter.
  const myNext = await readNextRequestId(signer, signer.publicKey);
  const derived: RequestEntry[] = [];
  for (let i = 0n; i < myNext; i++) {
    if (
      !entries.some(
        (e) => e.payer === signer.publicKey.toBase58() && e.requestId === i.toString(),
      )
    ) {
      derived.push({
        payer: signer.publicKey.toBase58(),
        requestId: i.toString(),
        direction: 'to_me',
        createdAt: Date.now(),
      });
    }
  }
  const all = [...entries, ...derived];
  return Promise.all(
    all.map(async (entry) => ({
      entry,
      account: await fetchRequest(
        signer,
        new PublicKey(entry.payer),
        BigInt(entry.requestId),
      ),
    })),
  );
}
