/**
 * actions.ts — high-level flows the screens call. Each returns real mainnet
 * results where the contract is settled, and is annotated where a leg is
 * best-effort (vault top-up onto the ER). Moves live USDC.
 */
import { Buffer } from './buffer';
import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { USDC_MINT } from './constants';
import type { Signer } from './signer';
import { getTeeToken } from './session';
import { getApiToken } from './apiSession';
import { teeConnection, baseConnection } from './connections';
import {
  buildDeposit,
  buildWithdraw,
  buildTransfer,
  signAndSend,
} from './payments';
import { readTeeBalance, isDelegated } from './tee';
import { sendBaseTx } from './chain';
import { fromUsdc } from './format';
import {
  createVaultIx,
  updatePolicyIx,
  reclaimIx,
  vaultPda,
  vaultAta,
  decodeAgentVault,
  type AgentVault,
  type Policy,
} from './vault';
import {
  addVaultEntry,
  removeVaultEntry,
  listVaultEntries,
  listLinkEntries,
  removeLinkEntry,
  type LinkEntry,
} from './registry';
import { claimClaimLink, parseClaimLink } from './claimlink';

const USDC = new PublicKey(USDC_MINT);

// ---------------------------------------------------------------------------
// Balance (TEE-native private read)
// ---------------------------------------------------------------------------
export async function getPrivateBalance(signer: Signer): Promise<bigint> {
  // The TEE ER clones the PUBLIC base balance for any account it hasn't seen
  // (spikes S2#9), so we must confirm the wallet is actually delegated before
  // trusting an ER read — otherwise a wallet that skipped its first deposit
  // would show its public USDC as a private balance.
  //
  // The delegated account is the Ephemeral SPL eATA, NOT the canonical ATA: a
  // deposit moves the tokens into a per-mint global vault and records the
  // balance in the eATA, leaving the canonical ATA an ordinary SPL-Token-owned
  // account forever. Checking the ATA's owner therefore never sees delegation.
  if (!(await isDelegated(signer.publicKey, USDC))) return 0n;
  // Delegated: the ER materializes the balance at the CANONICAL ATA (Model A).
  const token = await getTeeToken(signer);
  return readTeeBalance(signer.publicKey, USDC, token);
}

/**
 * The wallet's PUBLIC USDC balance on the base layer — the spendable pool a
 * deposit draws from. Reads the owner's canonical USDC ATA directly (SPL amount
 * @ offset 64); returns 0n when the ATA doesn't exist yet (never funded).
 */
export async function getPublicUsdcBalance(owner: PublicKey): Promise<bigint> {
  const ata = getAssociatedTokenAddressSync(USDC, owner, true);
  const info = await baseConnection().getAccountInfo(ata);
  if (!info || info.data.length < 72) return 0n;
  return Buffer.from(info.data).readBigUInt64LE(64);
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
  // Two auth domains: the Payments API verifies the `apiToken` (from apiLogin)
  // on the build request; the TEE RPC verifies `teeToken` on the ephemeral
  // submit. They are NOT interchangeable.
  const [apiToken, teeToken] = await Promise.all([
    getApiToken(signer),
    getTeeToken(signer),
  ]);
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
    apiToken,
  );
  return signAndSend(built, signer, teeToken);
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
 * Top up a vault's allowance. BEST-EFFORT: funds the vault PDA's
 * private balance via a hosted private transfer to the vault address. The vault
 * ATA must be onboarded/delegated on the ER to receive (spikes S2#7).
 */
export async function topUpVault(
  signer: Signer,
  agent: PublicKey,
  dollars: number,
): Promise<string> {
  const [vault] = vaultPda(signer.publicKey, agent);
  const [apiToken, teeToken] = await Promise.all([
    getApiToken(signer),
    getTeeToken(signer),
  ]);
  const built = await buildTransfer(
    {
      from: signer.publicKey.toBase58(),
      to: vault.toBase58(),
      amount: dollars,
      visibility: 'private',
      fromBalance: 'ephemeral',
      toBalance: 'ephemeral',
    },
    apiToken,
  );
  return signAndSend(built, signer, teeToken);
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
// Payment links (claim links) — replace the old request-to-pay flow. A link is
// a throwaway account holding shielded funds until someone opens it; see
// lib/claimlink for the mechanism. Here we surface status + reclaim.
// ---------------------------------------------------------------------------
export interface LinkView {
  entry: LinkEntry;
  amount: bigint; // base units currently sitting on the link account
  claimed: boolean; // true once the funds have been swept off it
}

/** Every link this device created, with live open/claimed status from chain. */
export async function fetchAllLinks(): Promise<LinkView[]> {
  const entries = await listLinkEntries();
  const conn = baseConnection();
  const views = await Promise.all(
    entries.map(async (entry) => {
      const ata = getAssociatedTokenAddressSync(
        USDC,
        new PublicKey(entry.linkAddress),
        true,
      );
      const info = await conn.getAccountInfo(ata);
      const amount =
        info && info.data.length >= 72
          ? Buffer.from(info.data).readBigUInt64LE(64)
          : 0n;
      return { entry, amount, claimed: amount === 0n };
    }),
  );
  return views.sort((a, b) => b.entry.createdAt - a.entry.createdAt);
}

/**
 * Reclaim an unclaimed link and return the funds to your PRIVATE balance. Two
 * legs: sweep the link account back to your public ATA (same mechanism as a
 * recipient claim, you as destination — possible because you kept the secret),
 * then re-shield that amount with a deposit so you end up exactly where you
 * started. If the re-shield leg fails, the money is still safely recovered on
 * your public ATA — surfaced via `reclaimed` on the error.
 */
export async function reclaimLink(signer: Signer, url: string): Promise<string> {
  const { keypair, linkAddress } = parseClaimLink(url);
  const { amount } = await claimClaimLink(signer.publicKey, keypair);
  await removeLinkEntry(linkAddress);
  try {
    return await deposit(signer, fromUsdc(amount));
  } catch (e) {
    throw new ReclaimReshieldError(amount, e);
  }
}

/**
 * The link was swept back to the caller's PUBLIC ATA, but the re-shield deposit
 * failed. The funds are safe (just not private yet); the caller can retry a
 * plain deposit of `reclaimed`.
 */
export class ReclaimReshieldError extends Error {
  constructor(
    public reclaimed: bigint,
    public cause: unknown,
  ) {
    super(
      'Reclaimed to your public balance, but moving it back into private failed. ' +
        'Your funds are safe — add them privately to finish.',
    );
    this.name = 'ReclaimReshieldError';
  }
}
