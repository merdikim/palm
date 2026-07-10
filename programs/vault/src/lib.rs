//! Per-agent escrow vaults for private payments on MagicBlock PER.
//!
//! Security model (see docs/architecture.md §4):
//!   - A vault is a program PDA. Its USDC token account (canonical ATA owned by
//!     the vault PDA) holds the agent's allowance.
//!   - `agent_pay` is signed by the AGENT, but funds move under the VAULT PDA's
//!     authority (invoke_signed). The agent directs payments; it never has
//!     custody and can never sweep funds to itself.
//!   - Policy checks and the debit are in the SAME instruction — no
//!     check-then-act gap.
//!
//! The PER delegation + access-control instructions live in `per.rs`, behind the
//! `per` feature, so this security-critical core compiles and unit-tests without
//! the ephemeral-rollups SDK on the critical path.

use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

pub mod errors;
pub mod policy;
pub mod state;

use errors::VaultError;
use policy::{effective_daily, evaluate, PolicyError, PolicyInput, PolicyOutcome};
use state::*;

/// Map the pure policy error to the on-chain Anchor error.
fn map_policy_err(e: PolicyError) -> anchor_lang::error::Error {
    let v = match e {
        PolicyError::ZeroAmount => VaultError::ZeroAmount,
        PolicyError::VaultExpired => VaultError::VaultExpired,
        PolicyError::AgentSelfPay => VaultError::AgentSelfPay,
        PolicyError::MerchantNotAllowed => VaultError::MerchantNotAllowed,
        PolicyError::ExceedsPerTx => VaultError::ExceedsPerTx,
        PolicyError::ExceedsDailyLimit => VaultError::ExceedsDailyLimit,
        PolicyError::SlippageExceeded => VaultError::SlippageExceeded,
        PolicyError::Overflow => VaultError::Overflow,
    };
    anchor_lang::error::Error::from(v)
}

declare_id!("3955LkKVs64NZTo9dGKXAoRx7wAURcKstuXZxDqoqYtW");

pub const VAULT_SEED: &[u8] = b"vault";
pub const REQUEST_SEED: &[u8] = b"request";
pub const COUNTER_SEED: &[u8] = b"req_counter";

#[program]
pub mod vault {
    use super::*;

    /// Owner creates a per-agent vault and its USDC token account. The vault's
    /// USDC balance (funded separately via deposit) is the agent's allowance.
    pub fn create_vault(ctx: Context<CreateVault>, policy: VaultPolicy) -> Result<()> {
        validate_policy(&policy, Clock::get()?.unix_timestamp)?;
        let v = &mut ctx.accounts.vault;
        v.owner = ctx.accounts.owner.key();
        v.agent = ctx.accounts.agent.key();
        v.bump = ctx.bumps.vault;
        v.expiry = policy.expiry;
        v.max_per_tx = policy.max_per_tx;
        v.max_slippage_bps = policy.max_slippage_bps;
        v.daily_limit = policy.daily_limit;
        v.spent_today = 0;
        v.window_start = Clock::get()?.unix_timestamp;
        v.merchant_allowlist = policy.merchant_allowlist;
        v.approval_threshold = policy.approval_threshold;
        v.lifetime_spent = 0;
        v.payment_count = 0;
        Ok(())
    }

    /// Owner updates policy at any time. Non-owner cannot reach this (seeds +
    /// has_one = owner enforce it).
    pub fn update_policy(ctx: Context<UpdatePolicy>, policy: VaultPolicy) -> Result<()> {
        validate_policy(&policy, Clock::get()?.unix_timestamp)?;
        let v = &mut ctx.accounts.vault;
        v.expiry = policy.expiry;
        v.max_per_tx = policy.max_per_tx;
        v.max_slippage_bps = policy.max_slippage_bps;
        v.daily_limit = policy.daily_limit;
        v.merchant_allowlist = policy.merchant_allowlist;
        v.approval_threshold = policy.approval_threshold;
        Ok(())
    }

    /// Agent directs a payment out of the vault. Signer MUST be the agent.
    /// Executes atomically iff every policy branch passes and the debit is at or
    /// under the approval threshold; otherwise it transfers nothing and errors
    /// (over-threshold payments go through `request_agent_approval`).
    ///
    /// `mint_out` is the token the merchant ultimately wants; on devnet (no DEX,
    /// see docs/spikes.md S5) the on-chain move is always the USDC debit to the
    /// merchant's USDC account — the swap leg is modelled by the client's
    /// SwapProvider and reflected in `quote`. All caps are on the USDC debit.
    pub fn agent_pay(
        ctx: Context<AgentPay>,
        mint_out: Pubkey,
        amount_out: u64,
        quote: QuoteContext,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let v = &mut ctx.accounts.vault;

        // Roll the daily window forward before evaluating.
        let (new_window_start, eff_spent) = effective_daily(v.window_start, v.spent_today, now);

        let merchant = ctx.accounts.merchant_usdc.owner;
        let input = PolicyInput {
            now,
            expiry: v.expiry,
            max_per_tx: v.max_per_tx,
            max_slippage_bps: v.max_slippage_bps,
            daily_limit: v.daily_limit,
            approval_threshold: v.approval_threshold,
            effective_spent_today: eff_spent,
            has_allowlist: v.merchant_allowlist.is_some(),
            merchant_on_allowlist: v.merchant_allowed(&merchant),
            merchant_is_agent: merchant == v.agent,
            amount_out,
            usdc_debit: quote.usdc_debit,
            quoted_slippage_bps: quote.quoted_slippage_bps,
        };
        require!(quote.usdc_debit >= 1, VaultError::ZeroAmount);
        require!(quote.usdc_debit >= min_debit_for(amount_out, mint_out, ctx.accounts.usdc_mint.key()), VaultError::BadQuote);

        match evaluate(&input).map_err(map_policy_err)? {
            PolicyOutcome::NeedsApproval { .. } => return err!(VaultError::ApprovalRequired),
            PolicyOutcome::Execute { usdc_debit } => {
                require!(ctx.accounts.vault_usdc.amount >= usdc_debit, VaultError::InsufficientFunds);
                transfer_from_vault(
                    &ctx.accounts.token_program,
                    &ctx.accounts.vault_usdc,
                    &ctx.accounts.merchant_usdc,
                    v,
                    usdc_debit,
                )?;
                // Commit counters (window reset + accumulators).
                v.window_start = new_window_start;
                v.spent_today = if new_window_start == now { usdc_debit } else { eff_spent.checked_add(usdc_debit).ok_or(VaultError::Overflow)? };
                v.lifetime_spent = v.lifetime_spent.checked_add(usdc_debit).ok_or(VaultError::Overflow)?;
                v.payment_count = v.payment_count.saturating_add(1);
            }
        }
        Ok(())
    }

    /// Owner reclaims funds from the vault at any time. `amount = None` reclaims
    /// the entire balance; `close = true` also closes the vault account (rent to
    /// owner). Only the owner can reach this.
    pub fn reclaim(ctx: Context<Reclaim>, amount: Option<u64>, close: bool) -> Result<()> {
        let bal = ctx.accounts.vault_usdc.amount;
        let amt = amount.unwrap_or(bal).min(bal);
        if amt > 0 {
            transfer_from_vault(
                &ctx.accounts.token_program,
                &ctx.accounts.vault_usdc,
                &ctx.accounts.owner_usdc,
                &ctx.accounts.vault,
                amt,
            )?;
        }
        if close {
            // Close the vault state account, returning rent to the owner.
            ctx.accounts.vault.close(ctx.accounts.owner.to_account_info())?;
        }
        Ok(())
    }

    /// User-to-user request-to-pay. Signer is the requester (who wants to be
    /// paid). Creates a PaymentRequest with members {requester, payer}.
    pub fn create_request(
        ctx: Context<CreateRequest>,
        payer: Pubkey,
        mint_out: Pubkey,
        amount_out: u64,
        expires_at: i64,
        memo_hash: [u8; 32],
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(amount_out > 0, VaultError::ZeroAmount);
        require!(expires_at > now, VaultError::BadExpiry);

        let counter = &mut ctx.accounts.counter;
        if counter.payer == Pubkey::default() {
            counter.payer = payer;
            counter.bump = ctx.bumps.counter;
            counter.next_id = 0;
        }
        let id = counter.next_id;
        counter.next_id = counter.next_id.checked_add(1).ok_or(VaultError::Overflow)?;

        let r = &mut ctx.accounts.request;
        r.requester = ctx.accounts.requester.key();
        r.payer = payer;
        r.vault = None;
        r.mint_out = mint_out;
        r.amount_out = amount_out;
        r.memo_hash = memo_hash;
        r.status = RequestStatus::Pending;
        r.created_at = now;
        r.expires_at = expires_at;
        r.request_id = id;
        r.bump = ctx.bumps.request;
        Ok(())
    }

    /// Agent creates an over-threshold approval request for the owner. Signer is
    /// the agent. Creates a PaymentRequest with payer = owner, vault set. No
    /// funds move.
    pub fn request_agent_approval(
        ctx: Context<RequestAgentApproval>,
        mint_out: Pubkey,
        amount_out: u64,
        _quote: QuoteContext,
        expires_at: i64,
        memo_hash: [u8; 32],
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(amount_out > 0 && _quote.usdc_debit > 0, VaultError::ZeroAmount);
        require!(expires_at > now, VaultError::BadExpiry);
        let v = &ctx.accounts.vault;

        let counter = &mut ctx.accounts.counter;
        if counter.payer == Pubkey::default() {
            counter.payer = v.owner;
            counter.bump = ctx.bumps.counter;
            counter.next_id = 0;
        }
        let id = counter.next_id;
        counter.next_id = counter.next_id.checked_add(1).ok_or(VaultError::Overflow)?;

        let r = &mut ctx.accounts.request;
        r.requester = ctx.accounts.agent.key();
        r.payer = v.owner;
        r.vault = Some(v.key());
        r.mint_out = mint_out;
        r.amount_out = amount_out;
        r.memo_hash = memo_hash;
        r.status = RequestStatus::Pending;
        r.created_at = now;
        r.expires_at = expires_at;
        r.request_id = id;
        r.bump = ctx.bumps.request;
        // Stash the quoted debit in amount via a convention is avoided; the
        // approver re-derives/re-checks policy on respond using `quote` echoed
        // by the client. We persist usdc_debit in memo? No — re-check at respond.
        Ok(())
    }

    /// Payer responds to a request. Only the payer may respond, exactly once.
    /// On accept:
    ///   - user-to-user (vault = None): transfer from the payer's own token
    ///     account to the requester (payer signs as authority);
    ///   - agent-approval (vault = Some): re-run vault policy and debit the
    ///     vault to the requester's USDC account (vault PDA authority).
    /// On deny or past expiry: mark status, move nothing.
    pub fn respond_request(ctx: Context<RespondRequest>, accept: bool, quote: QuoteContext) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(ctx.accounts.request.status == RequestStatus::Pending, VaultError::RequestNotPending);

        // Expired → mark expired, no transfer, regardless of accept.
        if now >= ctx.accounts.request.expires_at {
            ctx.accounts.request.status = RequestStatus::Expired;
            return Ok(());
        }
        if !accept {
            ctx.accounts.request.status = RequestStatus::Denied;
            return Ok(());
        }

        let amount_out = ctx.accounts.request.amount_out;
        let is_agent_req = ctx.accounts.request.vault.is_some();

        if is_agent_req {
            // Agent-approval path: vault must be provided and match.
            let vault_ai = ctx.accounts.vault.as_ref().ok_or(error!(VaultError::BadTokenAccounts))?;
            require_keys_eq!(ctx.accounts.request.vault.unwrap(), vault_ai.key(), VaultError::BadTokenAccounts);
            let vault_usdc = ctx.accounts.vault_usdc.as_ref().ok_or(error!(VaultError::BadTokenAccounts))?;
            let dest = ctx.accounts.dest_usdc.as_ref().ok_or(error!(VaultError::BadTokenAccounts))?;

            // Re-run policy at approval time on the echoed quote.
            let (new_window_start, eff_spent) = effective_daily(vault_ai.window_start, vault_ai.spent_today, now);
            let input = PolicyInput {
                now,
                expiry: vault_ai.expiry,
                max_per_tx: vault_ai.max_per_tx,
                max_slippage_bps: vault_ai.max_slippage_bps,
                daily_limit: vault_ai.daily_limit,
                approval_threshold: None, // approval already granted by owner
                effective_spent_today: eff_spent,
                has_allowlist: vault_ai.merchant_allowlist.is_some(),
                merchant_on_allowlist: vault_ai.merchant_allowed(&dest.owner),
                merchant_is_agent: dest.owner == vault_ai.agent,
                amount_out,
                usdc_debit: quote.usdc_debit,
                quoted_slippage_bps: quote.quoted_slippage_bps,
            };
            let usdc_debit = match evaluate(&input).map_err(map_policy_err)? {
                PolicyOutcome::Execute { usdc_debit } => usdc_debit,
                PolicyOutcome::NeedsApproval { usdc_debit } => usdc_debit, // threshold disabled above
            };
            require!(vault_usdc.amount >= usdc_debit, VaultError::InsufficientFunds);

            let vault = ctx.accounts.vault.as_ref().unwrap();
            transfer_from_vault(&ctx.accounts.token_program, vault_usdc, dest, vault, usdc_debit)?;

            let v = ctx.accounts.vault.as_mut().unwrap();
            v.window_start = new_window_start;
            v.spent_today = if new_window_start == now { usdc_debit } else { eff_spent.checked_add(usdc_debit).ok_or(VaultError::Overflow)? };
            v.lifetime_spent = v.lifetime_spent.checked_add(usdc_debit).ok_or(VaultError::Overflow)?;
            v.payment_count = v.payment_count.saturating_add(1);
        } else {
            // User-to-user path: payer's own balance -> requester.
            let src = ctx.accounts.payer_source.as_ref().ok_or(error!(VaultError::BadTokenAccounts))?;
            let dest = ctx.accounts.dest_usdc.as_ref().ok_or(error!(VaultError::BadTokenAccounts))?;
            require_keys_eq!(src.owner, ctx.accounts.payer.key(), VaultError::BadTokenAccounts);
            require!(src.amount >= amount_out, VaultError::InsufficientFunds);
            let cpi = CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: src.to_account_info(),
                    to: dest.to_account_info(),
                    authority: ctx.accounts.payer.to_account_info(),
                },
            );
            token::transfer(cpi, amount_out)?;
        }

        ctx.accounts.request.status = RequestStatus::Accepted;
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Minimum USDC debit that a quote must cover for `amount_out` of `mint_out`.
/// For a direct USDC payment the debit must be >= amount_out. For a swap
/// (mint_out != USDC) any positive quote is accepted here; the slippage bound in
/// `evaluate` is what constrains the price.
fn min_debit_for(amount_out: u64, mint_out: Pubkey, usdc_mint: Pubkey) -> u64 {
    if mint_out == usdc_mint {
        amount_out
    } else {
        1
    }
}

fn validate_policy(p: &VaultPolicy, now: i64) -> Result<()> {
    require!(p.max_per_tx > 0, VaultError::ZeroAmount);
    if let Some(list) = &p.merchant_allowlist {
        require!(list.len() <= MAX_ALLOWLIST, VaultError::AllowlistTooLong);
    }
    if let Some(e) = p.expiry {
        require!(e > now, VaultError::BadExpiry);
    }
    Ok(())
}

/// Transfer USDC out of the vault's token account under the vault PDA's
/// authority (invoke_signed with the vault seeds).
fn transfer_from_vault<'info>(
    token_program: &Program<'info, Token>,
    from: &Account<'info, TokenAccount>,
    to: &Account<'info, TokenAccount>,
    vault: &Account<'info, AgentVault>,
    amount: u64,
) -> Result<()> {
    let owner = vault.owner;
    let agent = vault.agent;
    let bump = vault.bump;
    let seeds: &[&[u8]] = &[VAULT_SEED, owner.as_ref(), agent.as_ref(), &[bump]];
    let signer: &[&[&[u8]]] = &[seeds];
    let cpi = CpiContext::new_with_signer(
        token_program.to_account_info(),
        Transfer {
            from: from.to_account_info(),
            to: to.to_account_info(),
            authority: vault.to_account_info(),
        },
        signer,
    );
    token::transfer(cpi, amount)
}

// ---------------------------------------------------------------------------
// Account contexts
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct CreateVault<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    /// CHECK: the agent's pubkey; part of the vault seeds, not a signer here.
    pub agent: UncheckedAccount<'info>,
    #[account(
        init,
        payer = owner,
        space = AgentVault::MAX_SIZE,
        seeds = [VAULT_SEED, owner.key().as_ref(), agent.key().as_ref()],
        bump,
    )]
    pub vault: Account<'info, AgentVault>,
    pub usdc_mint: Account<'info, Mint>,
    #[account(
        init,
        payer = owner,
        associated_token::mint = usdc_mint,
        associated_token::authority = vault,
    )]
    pub vault_usdc: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdatePolicy<'info> {
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [VAULT_SEED, owner.key().as_ref(), vault.agent.as_ref()],
        bump = vault.bump,
        has_one = owner @ VaultError::NotOwner,
    )]
    pub vault: Account<'info, AgentVault>,
}

#[derive(Accounts)]
pub struct AgentPay<'info> {
    pub agent: Signer<'info>,
    #[account(
        mut,
        seeds = [VAULT_SEED, vault.owner.as_ref(), agent.key().as_ref()],
        bump = vault.bump,
        has_one = agent @ VaultError::NotAgent,
    )]
    pub vault: Account<'info, AgentVault>,
    pub usdc_mint: Account<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = vault,
    )]
    pub vault_usdc: Account<'info, TokenAccount>,
    /// Merchant's USDC token account (destination of the debit).
    #[account(mut, constraint = merchant_usdc.mint == usdc_mint.key() @ VaultError::BadTokenAccounts)]
    pub merchant_usdc: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Reclaim<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [VAULT_SEED, owner.key().as_ref(), vault.agent.as_ref()],
        bump = vault.bump,
        has_one = owner @ VaultError::NotOwner,
    )]
    pub vault: Account<'info, AgentVault>,
    pub usdc_mint: Account<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = vault,
    )]
    pub vault_usdc: Account<'info, TokenAccount>,
    #[account(mut, constraint = owner_usdc.owner == owner.key() @ VaultError::BadTokenAccounts)]
    pub owner_usdc: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(payer: Pubkey)]
pub struct CreateRequest<'info> {
    #[account(mut)]
    pub requester: Signer<'info>,
    #[account(
        init_if_needed,
        payer = requester,
        space = RequestCounter::MAX_SIZE,
        seeds = [COUNTER_SEED, payer.as_ref()],
        bump,
    )]
    pub counter: Account<'info, RequestCounter>,
    #[account(
        init,
        payer = requester,
        space = PaymentRequest::MAX_SIZE,
        seeds = [REQUEST_SEED, payer.as_ref(), counter.next_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub request: Account<'info, PaymentRequest>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RequestAgentApproval<'info> {
    #[account(mut)]
    pub agent: Signer<'info>,
    #[account(
        seeds = [VAULT_SEED, vault.owner.as_ref(), agent.key().as_ref()],
        bump = vault.bump,
        has_one = agent @ VaultError::NotAgent,
    )]
    pub vault: Account<'info, AgentVault>,
    #[account(
        init_if_needed,
        payer = agent,
        space = RequestCounter::MAX_SIZE,
        seeds = [COUNTER_SEED, vault.owner.as_ref()],
        bump,
    )]
    pub counter: Account<'info, RequestCounter>,
    #[account(
        init,
        payer = agent,
        space = PaymentRequest::MAX_SIZE,
        seeds = [REQUEST_SEED, vault.owner.as_ref(), counter.next_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub request: Account<'info, PaymentRequest>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RespondRequest<'info> {
    pub payer: Signer<'info>,
    #[account(
        mut,
        seeds = [REQUEST_SEED, payer.key().as_ref(), request.request_id.to_le_bytes().as_ref()],
        bump = request.bump,
        constraint = request.payer == payer.key() @ VaultError::NotPayer,
    )]
    pub request: Account<'info, PaymentRequest>,
    pub token_program: Program<'info, Token>,

    // --- user-to-user path (vault = None): payer's own account -> requester ---
    #[account(mut)]
    pub payer_source: Option<Account<'info, TokenAccount>>,

    // --- agent-approval path (vault = Some): vault debit -> requester ---
    #[account(mut)]
    pub vault: Option<Account<'info, AgentVault>>,
    #[account(mut)]
    pub vault_usdc: Option<Account<'info, TokenAccount>>,

    /// Destination token account (requester's / merchant's).
    #[account(mut)]
    pub dest_usdc: Option<Account<'info, TokenAccount>>,
}
