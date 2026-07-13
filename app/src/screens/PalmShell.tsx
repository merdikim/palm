/**
 * PalmShell — the signed-in app: header with lock toggle, Home / Agents /
 * Links tabs, a bottom nav, and the action bottom-sheets (add, send, send via
 * link, claim, withdraw, create agent, agent detail, top up, edit policy).
 *
 * All money actions call the real mainnet flows in lib/actions; the private
 * balance, vaults, links, and activity are read via @tanstack/react-query
 * (see hooks/useSolanaData) and invalidated after each action. Sensitive
 * numbers are masked while the balance is "locked".
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useRef } from 'react';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import * as Notifications from 'expo-notifications';

import { useWallet } from '../context/WalletContext';
import { useBalance, useVaults, useLinks, useActivity, useInvalidateData } from '../hooks/useSolanaData';
import {
  deposit,
  withdraw,
  privateTransfer,
  reclaimLink,
  ReclaimReshieldError,
  createVault,
  topUpVault,
  updateVaultPolicy,
  revokeVault,
  type VaultView,
  type LinkView,
} from '../lib/actions';
import { RecipientNotOnboardedError } from '../lib/payments';
import {
  createClaimLink,
  claimClaimLink,
  parseClaimLink,
  isClaimLink,
  type ParsedClaimLink,
} from '../lib/claimlink';
import type { Policy } from '../lib/vault';
import { APP_NAME } from '../constants/app-config';
import { formatUsd, fromUsdc, usdcBase, shortKey } from '../lib/format';
import { addActivity, activityTime, type ActivityItem } from '../lib/activity';
import { palm } from '../theme';
import { Icon, type IconName } from '../components/icons';
import {
  T,
  Logo,
  PrimaryButton,
  OutlineButton,
  Chip,
  MarkAvatar,
  Sheet,
  SheetStatus,
  Secret,
  Keypad,
} from '../components/palm';

// ── helpers ──────────────────────────────────────────────────────────────────
const fmt0 = (n: number) => '$' + Math.round(Math.abs(n)).toLocaleString('en-US');
const nice = (n: number) => {
  if (n <= 1) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(n)));
  const c = [1, 1.5, 2, 2.5, 5, 7.5, 10].map((m) => m * p);
  let best = c[0];
  c.forEach((x) => {
    if (Math.abs(x - n) < Math.abs(best - n)) best = x;
  });
  return Math.max(1, Math.round(best));
};

type SheetKind =
  | 'add'
  | 'send'
  | 'sendlink'
  | 'claim'
  | 'withdraw'
  | 'create'
  | 'vault'
  | 'topup'
  | 'edit'
  | 'account'
  | null;


export function PalmShell() {
  const w = useWallet();
  // Bottom nav sits outside the safe area (SafeAreaView only insets the top), so
  // pad it clear of the phone's gesture bar / nav buttons.
  const insets = useSafeAreaInsets();

  // navigation / lock
  const [tab, setTab] = useState<'home' | 'agents' | 'links'>('home');
  const [locked, setLocked] = useState(false);
  const [unlocking, setUnlocking] = useState(false);

  // data (react-query)
  const balanceQ = useBalance();
  const vaultsQ = useVaults();
  const linksQ = useLinks();
  const activityQ = useActivity();
  const invalidate = useInvalidateData();

  const balance = balanceQ.data ?? null;
  const vaults: VaultView[] = vaultsQ.data ?? [];
  const links: LinkView[] = linksQ.data ?? [];
  const activity: ActivityItem[] = activityQ.data ?? [];
  const loading = balanceQ.isFetching || vaultsQ.isFetching || linksQ.isFetching || activityQ.isFetching;

  // sheet
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [doneText, setDoneText] = useState({ title: '', caption: '' });
  const [busyText, setBusyText] = useState({ title: '', caption: '' });

  // sheet inputs
  const [amount, setAmount] = useState('');
  const [recipient, setRecipient] = useState('');
  const [memo, setMemo] = useState('');
  // The incoming claim link being reviewed (opened via a `palm://claim#…` deep link).
  const [pendingClaim, setPendingClaim] = useState<ParsedClaimLink | null>(null);
  const [vName, setVName] = useState('');
  const [selVaultAgent, setSelVaultAgent] = useState<string | null>(null);
  const [draft, setDraft] = useState({ cap: 0, daily: 0, allow: false, thresh: 0 });
  const [revokeAsk, setRevokeAsk] = useState(false);


  // toast
  const [toast, setToast] = useState<string | null>(null);
  const toastY = useRef(new Animated.Value(20)).current;
  const showToast = useCallback(
    (msg: string) => {
      setToast(msg);
      toastY.setValue(20);
      Animated.timing(toastY, { toValue: 0, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
      setTimeout(() => setToast(null), 3200);
    },
    [toastY],
  );

  const balanceDollars = balance != null ? fromUsdc(balance) : 0;

  // react-query owns fetching; "reload" just busts the caches
  const reloadAll = invalidate;

  // deep-link push taps → Links tab
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(() => {
      setTab('links');
      invalidate();
    });
    return () => sub.remove();
  }, [invalidate]);

  // Incoming claim links (palm://claim#…) → open the claim review sheet. Handles
  // both a cold start (getInitialURL) and a link tapped while the app is open.
  useEffect(() => {
    const handle = (url: string | null) => {
      if (!url || !isClaimLink(url)) return;
      try {
        setPendingClaim(parseClaimLink(url));
        setSheet('claim');
        setStep(0);
      } catch (e) {
        showToast((e as Error).message);
      }
    };
    Linking.getInitialURL().then(handle).catch(() => {});
    const sub = Linking.addEventListener('url', (e) => handle(e.url));
    return () => sub.remove();
  }, [showToast]);

  // ── lock ─────────────────────────────────────────────────────────────────--
  const unlock = () => {
    if (!locked || unlocking) return;
    setUnlocking(true);
    setTimeout(() => {
      setUnlocking(false);
      setLocked(false);
    }, 1300);
  };
  const toggleLock = () => {
    if (locked) unlock();
    else {
      setLocked(true);
      showToast('Locked. Balances hidden.');
    }
  };

  // ── sheet helpers ────────────────────────────────────────────────────────---
  const openSheet = (kind: SheetKind, reset?: Partial<{ agent: string }>) => {
    setSheet(kind);
    setStep(0);
    setBusy(false);
    setDone(false);
    setAmount('');
    setRecipient('');
    setMemo('');
    setRevokeAsk(false);
    if (reset?.agent) setSelVaultAgent(reset.agent);
  };
  const closeSheet = () => {
    setSheet(null);
    setBusy(false);
    setDone(false);
  };

  const selVault = useMemo(
    () => vaults.find((v) => v.agent === selVaultAgent) ?? vaults[0],
    [vaults, selVaultAgent],
  );

  const amt = parseFloat(amount || '0') || 0;
  const amtOk = amt > 0;

  const onKey = (k: string) => {
    let a = amount;
    if (k === '⌫') a = a.slice(0, -1);
    else if (k === '.') {
      if (!a.includes('.')) a = (a || '0') + '.';
    } else if (a.replace('.', '').length < 7) a = a === '0' ? k : a + k;
    setAmount(a);
  };

  const runFlow = async (
    fn: () => Promise<void>,
    labels: { busy: [string, string]; done: [string, string] },
    onErr?: (e: unknown) => void,
  ) => {
    setBusy(true);
    setBusyText({ title: labels.busy[0], caption: labels.busy[1] });
    try {
      await fn();
      setBusy(false);
      setDone(true);
      setDoneText({ title: labels.done[0], caption: labels.done[1] });
      reloadAll();
    } catch (e) {
      setBusy(false);
      closeSheet();
      if (onErr) onErr(e);
      else if (e instanceof RecipientNotOnboardedError) showToast(e.message);
      else showToast((e as Error).message);
    }
  };

  // ── actions ──────────────────────────────────────────────────────────────---
  const doAdd = () =>
    runFlow(
      async () => {
        await deposit(w.signer!, amt);
        await addActivity({ kind: 'in', title: 'Added funds', amount: amt });
      },
      { busy: ['Confirming on-chain', 'About 10 seconds. Your deposit is being shielded.'], done: [`${formatUsd(usdcBase(amt))} added`, 'Your private balance has been updated.'] },
    );

  const doSend = () =>
    runFlow(
      async () => {
        await privateTransfer(w.signer!, recipient.trim(), amt);
        await addActivity({ kind: 'out', title: `Sent to ${shortKey(recipient.trim())}`, amount: -amt });
      },
      { busy: ['Sending privately', 'Nothing about this payment is publicly visible.'], done: ['Sent privately', `${shortKey(recipient.trim())} received ${formatUsd(usdcBase(amt))}. No one else can see it happened.`] },
    );

  // Send via link: mint a claim link from the shielded balance, then hand it off
  // through the OS share sheet. No recipient address needed — see lib/claimlink.
  const doSendLink = () =>
    runFlow(
      async () => {
        const link = await createClaimLink(w.signer!, amt, memo.trim() || undefined);
        await addActivity({ kind: 'out', title: 'Sent via link', amount: -amt, pending: true });
        await Share.share({
          message: memo.trim()
            ? `${memo.trim()}\n\nClaim your $${amt} on ${APP_NAME}: ${link.url}`
            : `Claim your $${amt} on ${APP_NAME}: ${link.url}`,
        });
      },
      {
        busy: ['Creating your link', 'Funding it from your private balance.'],
        done: ['Link ready', 'Anyone with the link can claim it — share it only with them. Unclaimed funds stay yours.'],
      },
    );

  // Claim an incoming link into the user's own wallet. The link account signs and
  // pays; we just name this wallet as the destination.
  const doClaim = () => {
    const claim = pendingClaim;
    if (!claim) return;
    return runFlow(
      async () => {
        const { amount: got } = await claimClaimLink(w.signer!.publicKey, claim.keypair);
        await addActivity({
          kind: 'in',
          title: claim.memo ? `Claimed: ${claim.memo}` : 'Claimed a link',
          amount: fromUsdc(got),
        });
      },
      {
        busy: ['Claiming', 'Moving the funds into your wallet.'],
        done: ['Claimed', 'The funds are in your wallet. Add them to your private balance any time.'],
      },
    );
  };

  const doWithdraw = () =>
    runFlow(
      async () => {
        await withdraw(w.signer!, amt);
        await addActivity({ kind: 'w', title: 'Withdrawal to public address', amount: -amt, pending: true });
      },
      { busy: ['Starting withdrawal', 'Leaving the private pool takes longer. Safe to close this.'], done: ['Withdrawal started', "We'll notify you when it lands."] },
    );

  const doTopup = () =>
    runFlow(
      async () => {
        await topUpVault(w.signer!, new PublicKey(selVault!.agent), amt);
      },
      { busy: ['Moving funds into the agent', 'From your private balance.'], done: ['Topped up', `${selVault?.label ?? 'The agent'} now has more to spend.`] },
    );

  const policyFromDraft = (): Policy => ({
    maxPerTx: usdcBase(Math.max(1, draft.cap || Math.max(5, amt * 0.1))),
    maxSlippageBps: 100,
    dailyLimit: draft.daily ? usdcBase(draft.daily) : null,
    merchantAllowlist: null,
    approvalThreshold: draft.thresh ? usdcBase(draft.thresh) : null,
    expiry: null,
  });

  const doCreate = () =>
    runFlow(
      async () => {
        const kp = Keypair.generate();
        await createVault(w.signer!, kp.publicKey, policyFromDraft(), vName || 'New agent');
        // fund the vault (best-effort)
        try {
          await topUpVault(w.signer!, kp.publicKey, amt);
        } catch {
          /* funding is best-effort; vault still created */
        }
        setDoneText({
          title: `${vName || 'Your agent'} is ready`,
          caption:
            `It can spend up to ${formatUsd(usdcBase(amt))} under your rules — pull it back anytime.\n\n` +
            `Agent secret (save to wire your automation):\n${bs58.encode(kp.secretKey)}`,
        });
      },
      { busy: ['Creating agent on-chain', `Walling off ${formatUsd(usdcBase(amt))} for ${vName || 'your agent'}. About 10 seconds.`], done: ['', ''] },
    );

  const doEdit = () =>
    runFlow(
      async () => {
        const cur = selVault!.account!;
        const policy: Policy = {
          maxPerTx: usdcBase(Math.max(1, draft.cap)),
          maxSlippageBps: cur.maxSlippageBps,
          dailyLimit: draft.daily ? usdcBase(draft.daily) : null,
          merchantAllowlist: cur.merchantAllowlist,
          approvalThreshold: draft.thresh ? usdcBase(draft.thresh) : null,
          expiry: cur.expiry,
        };
        await updateVaultPolicy(w.signer!, new PublicKey(selVault!.agent), policy);
      },
      { busy: ['Updating policy', 'Applies to the next payment this agent tries to make.'], done: ['Policy updated', 'Takes effect immediately.'] },
    );

  const doRevoke = async () => {
    if (!selVault) return;
    setRevokeAsk(false);
    closeSheet();
    try {
      await revokeVault(w.signer!, new PublicKey(selVault.agent));
      showToast(`Funds returned to your balance. ${selVault.label ?? 'Agent'} can no longer spend.`);
      reloadAll();
    } catch (e) {
      showToast((e as Error).message);
    }
  };

  // Re-open the OS share sheet for a link (e.g. dismissed the first time).
  const reshareLink = async (link: LinkView) => {
    try {
      await Share.share({
        message: link.entry.memo
          ? `${link.entry.memo}\n\nClaim your ${formatUsd(link.amount)} on ${APP_NAME}: ${link.entry.url}`
          : `Claim your ${formatUsd(link.amount)} on ${APP_NAME}: ${link.entry.url}`,
      });
    } catch (e) {
      showToast((e as Error).message);
    }
  };

  // Pull an unclaimed link's funds back into your private balance (sweep + re-shield).
  const doReclaim = async (link: LinkView) => {
    const back = link.amount;
    try {
      await reclaimLink(w.signer!, link.entry.url);
      await addActivity({ kind: 'in', title: 'Reclaimed a link', amount: fromUsdc(back) });
      showToast(`Reclaimed ${formatUsd(back)} to your private balance`);
    } catch (e) {
      if (e instanceof ReclaimReshieldError) {
        // Funds are recovered to the public ATA; the shield step is all that failed.
        await addActivity({ kind: 'in', title: 'Reclaimed a link (public)', amount: fromUsdc(e.reclaimed) });
      }
      showToast((e as Error).message);
    } finally {
      reloadAll();
    }
  };

  // ── derived: link grouping ─────────────────────────────────────────────────
  const me = w.publicKey;
  const openLinks = links.filter((l) => !l.claimed);
  const openLinksCount = openLinks.length;

  // Disconnect the wallet: revokes the MWA session (or wipes the local key) and
  // resets onboarding. The App gate reacts to signer/step becoming null/welcome
  // and swaps back to the OnboardingScreen — no manual navigation needed.
  const disconnect = () => {
    closeSheet();
    w.signOut().catch((e) => showToast((e as Error).message));
  };

  // ── render ───────────────────────────────────────────────────────────────---
  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      {/* header */}
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
          <Logo size={28} />
          <T weight="bold" size={17}>
            Palm
          </T>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Pressable
            onPress={toggleLock}
            style={styles.iconBtn}
            accessibilityLabel={unlocking ? 'Unlocking' : locked ? 'Locked' : 'Unlocked'}
          >
            {unlocking ? (
              <ActivityIndicator size="small" color={palm.green} />
            ) : (
              <Icon name={locked ? 'lock' : 'unlock'} size={17} color={locked ? palm.green : palm.inkDim} strokeWidth={2.2} />
            )}
          </Pressable>
          <Pressable onPress={() => openSheet('account')} style={styles.iconBtn} accessibilityLabel="Account">
            <Icon name="wallet" size={18} color={palm.ink} strokeWidth={2} />
          </Pressable>
        </View>
      </View>

      {/* content */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={reloadAll} tintColor={palm.inkFaint} />}
      >
        {tab === 'home' && <HomeTab />}
        {tab === 'agents' && <AgentsTab />}
        {tab === 'links' && <LinksTab />}
      </ScrollView>

      {/* bottom nav */}
      <View style={[styles.nav, { paddingBottom: 6 + insets.bottom }]}>
        {([
          { key: 'home', label: 'Home', icon: 'home' as IconName },
          { key: 'agents', label: 'Agents', icon: 'agents' as IconName },
          { key: 'links', label: 'Links', icon: 'link' as IconName },
        ] as const).map((n) => {
          const active = tab === n.key;
          const fg = active ? palm.green : palm.inkFaint;
          return (
            <Pressable key={n.key} onPress={() => setTab(n.key)} style={styles.navItem}>
              <Icon name={n.icon} size={21} color={fg} strokeWidth={2} />
              <T weight="semibold" size={11} color={fg}>
                {n.label}
              </T>
              {n.key === 'links' && openLinksCount > 0 && (
                <View style={styles.navBadge}>
                  <T weight="bold" size={10} color={palm.onDark}>
                    {openLinksCount}
                  </T>
                </View>
              )}
            </Pressable>
          );
        })}
      </View>

      {/* toast */}
      {toast && (
        <Animated.View style={[styles.toast, { transform: [{ translateY: toastY }] }]}>
          <T weight="semibold" size={13} color={palm.onDark} style={{ textAlign: 'center' }}>
            {toast}
          </T>
        </Animated.View>
      )}

      {/* sheets */}
      {renderSheet()}
    </SafeAreaView>
  );

  // ── tab renderers ──────────────────────────────────────────────────────────
  function HomeTab() {
    const actions: { label: string; icon: IconName; onPress: () => void }[] = [
      { label: 'Add', icon: 'add', onPress: () => openSheet('add') },
      { label: 'Send', icon: 'send', onPress: () => openSheet('send') },
      { label: 'Withdraw', icon: 'withdraw', onPress: () => openSheet('withdraw') },
      { label: 'Send link', icon: 'link', onPress: () => openSheet('sendlink') }
    ];
    return (
      <View style={{ gap: 20 }}>
        {/* balance card */}
        <Pressable onPress={unlock} style={styles.balanceCard}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <T weight="semibold" size={12.5} color={palm.onDarkDim} style={{ letterSpacing: 0.6 }}>
              PRIVATE BALANCE
            </T>
            <Icon name={locked ? 'lock' : 'unlock'} size={15} color={palm.onDarkDim} strokeWidth={2} />
          </View>
          <View style={{ marginTop: 12 }}>
            {locked ? (
              <Secret locked w={180} h={38} dark>
                <View />
              </Secret>
            ) : (
              <T weight="bold" size={38} color={palm.onDark} style={{ letterSpacing: -0.8 }}>
                {balance == null ? '—' : formatUsd(balance)}
              </T>
            )}
          </View>
          {locked && (
            <View style={styles.unlockPill}>
              {unlocking ? (
                <>
                  <ActivityIndicator color={palm.onDark} size="small" />
                  <T weight="semibold" size={13} color={palm.onDark}>
                    Verifying your signature…
                  </T>
                </>
              ) : (
                <>
                  <Icon name="unlock" size={13} color={palm.onDark} strokeWidth={2.2} />
                  <T weight="semibold" size={13} color={palm.onDark}>
                    Tap to unlock
                  </T>
                </>
              )}
            </View>
          )}
        </Pressable>

        {/* actions */}
        <View style={{ flexDirection: 'row' }}>
          {actions.map((a) => (
            <Pressable key={a.label} onPress={a.onPress} style={styles.actionBtn}>
              <View style={styles.actionIcon}>
                <Icon name={a.icon} size={20} color={palm.green} strokeWidth={2.1} />
              </View>
              <T weight="semibold" size={12} color={palm.inkSoft}>
                {a.label}
              </T>
            </Pressable>
          ))}
        </View>

        {/* activity */}
        <View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <T weight="bold" size={15}>
              Activity
            </T>
            <View style={styles.onlyYou}>
              <Icon name="shield" size={10} color={palm.green} strokeWidth={2.4} />
              <T weight="semibold" size={11} color={palm.green}>
                Only you can see this
              </T>
            </View>
          </View>
          <View style={styles.activityCard}>
            {activity.length === 0 ? (
              <View style={{ padding: 24, height: 200, justifyContent: 'center', alignItems: 'center' }}>
                <T size={13.5} color={palm.inkFaint}>
                  Your private activity will appear here.
                </T>
              </View>
            ) : (
              activity.map((a, i) => <ActivityRow key={a.id} item={a} last={i === activity.length - 1} />)
            )}
          </View>
        </View>
      </View>
    );
  }

  function ActivityRow({ item, last }: { item: ActivityItem; last: boolean }) {
    const glyph: Record<ActivityItem['kind'], { icon: IconName; tint: string; fg: string }> = {
      in: { icon: 'in', tint: '#E1EFE6', fg: palm.green },
      out: { icon: 'out', tint: '#EEF1EE', fg: palm.inkSoft },
      agent: { icon: 'agentGlyph', tint: '#F2EEDB', fg: palm.amber },
      w: { icon: 'w', tint: palm.amberBgStrong, fg: palm.amber },
    };
    const g = glyph[item.kind];
    const sign = item.amount >= 0 ? '+' : '−';
    return (
      <View style={[styles.activityRow, !last && styles.activityDivider]}>
        <View style={[styles.activityIcon, { backgroundColor: g.tint }]}>
          <Icon name={g.icon} size={15} color={g.fg} strokeWidth={2.1} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <T weight="semibold" size={14} numberOfLines={1}>
            {item.title}
          </T>
          <T size={12} color={palm.inkFaint} style={{ marginTop: 1 }}>
            {activityTime(item.ts)}
          </T>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          {locked ? (
            <Secret locked w={52} h={16} />
          ) : (
            <T weight="bold" size={14} color={item.amount >= 0 ? palm.green : palm.ink}>
              {sign}
              {formatUsd(usdcBase(Math.abs(item.amount)))}
            </T>
          )}
          {item.pending && (
            <View style={styles.transit}>
              <T weight="semibold" size={11} color={palm.amber}>
                In transit
              </T>
            </View>
          )}
        </View>
      </View>
    );
  }

  function AgentsTab() {
    const active = vaults.filter((v) => v.account);
    const delegated = active.reduce((a, v) => a + Number(v.remainingAllowance), 0);
    return (
      <View style={{ gap: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <View>
            <T weight="bold" size={22} style={{ letterSpacing: -0.5 }}>
              Agents
            </T>
            <T size={13} color={palm.inkDim} style={{ marginTop: 2 }}>
              {active.length} active · {formatUsd(BigInt(Math.round(delegated)))} delegated
            </T>
          </View>
          <Pressable
            onPress={() => {
              setVName('');
              openSheet('create');
            }}
            style={styles.newVaultBtn}
          >
            <T weight="semibold" size={13} color={palm.onDark}>
              + New agent
            </T>
          </Pressable>
        </View>

        {locked && (
          <Pressable onPress={unlock} style={styles.lockedBanner}>
            <Icon name="unlock" size={14} color={palm.onDark} strokeWidth={2.2} />
            <T weight="semibold" size={13} color={palm.onDark}>
              Balances hidden — tap to unlock
            </T>
          </Pressable>
        )}

        {vaults.length === 0 && (
          <View style={styles.emptyCard}>
            <T size={14} color={palm.inkDim} style={{ textAlign: 'center', lineHeight: 21 }}>
              No agents yet. Create one to give an automation a private, capped allowance.
            </T>
          </View>
        )}

        {vaults.map((v) => (
          <VaultCard key={v.agent} v={v} />
        ))}
      </View>
    );
  }

  function VaultCard({ v }: { v: VaultView }) {
    const name = v.label ?? shortKey(v.agent);
    const rem = Number(v.remainingAllowance);
    const spent = v.account ? Number(v.account.lifetimeSpent) : 0;
    const funded = rem + spent;
    const pct = funded > 0 ? Math.min(100, Math.round((spent / funded) * 100)) : 0;
    const chips: string[] = [];
    if (v.account) {
      chips.push(`≤ ${fmt0(fromUsdc(v.account.maxPerTx))} / payment`);
      if (v.account.dailyLimit != null) chips.push(`${fmt0(fromUsdc(v.account.dailyLimit))} / day`);
      if (v.account.merchantAllowlist) chips.push(`Allowlist · ${v.account.merchantAllowlist.length}`);
      if (v.account.approvalThreshold != null) chips.push(`Ask me above ${fmt0(fromUsdc(v.account.approvalThreshold))}`);
    }
    return (
      <Pressable onPress={() => openSheet('vault', { agent: v.agent })} style={styles.vaultCard}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 13 }}>
          <MarkAvatar name={name} size={44} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <T weight="bold" size={15.5}>
              {name}
            </T>
            <T size={12.5} color={palm.inkFaint}>
              {v.account ? 'Agent' : 'Pending on-chain'}
            </T>
          </View>
          {v.account ? (
            <View style={{ alignItems: 'flex-end' }}>
              {locked ? (
                <Secret locked w={60} h={18} />
              ) : (
                <T weight="bold" size={17}>
                  {formatUsd(v.remainingAllowance)}
                </T>
              )}
              <T size={11} color={palm.inkFaint}>
                left to spend
              </T>
            </View>
          ) : (
            <Chip label="Pending" bg="#EEF1EE" fg="#7A7F7C" />
          )}
        </View>

        {v.account && !locked && (
          <View style={{ marginTop: 14 }}>
            <View style={styles.progressTrack}>
              <View style={{ width: `${pct}%`, backgroundColor: '#B9CFC2', borderRadius: 4 }} />
              <View style={{ flex: 1, backgroundColor: palm.green, borderRadius: 4, marginLeft: 2 }} />
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
              <T size={11.5} color={palm.inkFaint}>
                spent {formatUsd(usdcBase(spent))} of {formatUsd(usdcBase(funded))}
              </T>
              <T size={11.5} color={palm.inkFaint}>
                {v.account.paymentCount} payments
              </T>
            </View>
            {chips.length > 0 && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
                {chips.map((c) => (
                  <Chip key={c} label={c} />
                ))}
              </View>
            )}
          </View>
        )}
      </Pressable>
    );
  }

  function LinksTab() {
    return (
      <View style={{ gap: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <T weight="bold" size={22} style={{ letterSpacing: -0.5, flex: 1 }}>
            Payment links
          </T>
          <Pressable onPress={() => openSheet('sendlink')} style={styles.newLinkBtn}>
            <Icon name="link" size={15} color={palm.green} strokeWidth={2.2} />
            <T weight="semibold" size={13} color={palm.green}>
              New link
            </T>
          </Pressable>
        </View>
        <T size={12.5} color={palm.inkFaint} style={{ lineHeight: 19 }}>
          Send money as a link — no address needed. Open links are still yours until claimed, and you can reclaim them any time.
        </T>

        {links.length === 0 ? (
          <View style={{ alignItems: 'center', paddingVertical: 44 }}>
            <View style={styles.emptyIcon}>
              <Icon name="link" size={20} color={palm.inkFaint} strokeWidth={2} />
            </View>
            <T weight="semibold" size={14} color={palm.inkDim} style={{ marginTop: 14 }}>
              No links yet.
            </T>
            <T size={12.5} color={palm.inkFaint} style={{ marginTop: 4 }}>
              Tap “New link” to send one.
            </T>
          </View>
        ) : (
          links.map((l) => <LinkCard key={l.entry.linkAddress} l={l} />)
        )}
      </View>
    );
  }

  function LinkCard({ l }: { l: LinkView }) {
    const tagFg = l.claimed ? '#7A7F7C' : palm.green;
    const tagBg = l.claimed ? '#EEF1EE' : '#E1EFE6';
    const shownAmount = l.claimed ? BigInt(l.entry.amount) : l.amount;
    return (
      <View style={[styles.reqCard, { backgroundColor: palm.card, borderColor: palm.border }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <View style={[styles.reqTag, { backgroundColor: tagBg }]}>
            <T weight="bold" size={10.5} color={tagFg} style={{ letterSpacing: 0.5 }}>
              {l.claimed ? 'CLAIMED' : 'OPEN'}
            </T>
          </View>
          <View style={{ flex: 1 }} />
          <T size={11.5} color={palm.inkFaint}>
            {new Date(l.entry.createdAt).toLocaleDateString()}
          </T>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <T weight="semibold" size={14.5} style={{ lineHeight: 20 }}>
              {l.entry.memo || 'Payment link'}
            </T>
            <T size={12.5} color={palm.inkDim} style={{ marginTop: 3 }}>
              {l.claimed ? 'Claimed by recipient' : shortKey(l.entry.linkAddress)}
            </T>
          </View>
          {locked ? (
            <Secret locked w={64} h={22} />
          ) : (
            <T weight="bold" size={19} color={l.claimed ? palm.inkFaint : palm.ink}>
              {formatUsd(shownAmount)}
            </T>
          )}
        </View>
        {!l.claimed && (
          <View style={{ flexDirection: 'row', gap: 9, marginTop: 13 }}>
            <OutlineButton title="Reclaim" onPress={() => doReclaim(l)} style={{ flex: 1 }} />
            <PrimaryButton title="Share again" onPress={() => reshareLink(l)} style={{ flex: 1.4, paddingVertical: 11 }} />
          </View>
        )}
      </View>
    );
  }

  // ── sheet renderer ─────────────────────────────────────────────────────────
  function renderSheet() {
    if (!sheet) return null;

    const titles: Record<string, string> = {
      add: 'Add funds',
      send: 'Send privately',
      sendlink: 'Send via link',
      claim: 'Claim a payment',
      withdraw: 'Withdraw',
      create: 'New agent',
      vault: selVault?.label ?? 'Agent',
      topup: `Top up ${selVault?.label ?? ''}`.trim(),
      edit: `Edit policy — ${selVault?.label ?? ''}`.trim(),
      account: 'Account',
    };

    const canBack =
      !busy &&
      !done &&
      ((sheet === 'send' && step > 0) ||
        (sheet === 'sendlink' && step > 0) ||
        (sheet === 'withdraw' && step > 0) ||
        (sheet === 'create' && step > 0) ||
        sheet === 'topup' ||
        sheet === 'edit');

    const onBack = () => {
      if (sheet === 'topup' || sheet === 'edit') openVaultFrom(selVault!);
      else setStep(Math.max(0, step - 1));
    };

    return (
      <Sheet visible={!!sheet} title={titles[sheet] ?? ''} onClose={closeSheet} canBack={canBack} onBack={onBack}>
        {busy ? (
          <SheetStatus kind="busy" title={busyText.title} caption={busyText.caption} />
        ) : done ? (
          <SheetStatus kind="done" title={doneText.title} caption={doneText.caption} onDone={closeSheet} />
        ) : (
          renderSheetBody()
        )}
      </Sheet>
    );
  }

  function openVaultFrom(v: VaultView) {
    setSelVaultAgent(v.agent);
    setSheet('vault');
    setStep(0);
    setRevokeAsk(false);
  }

  function renderSheetBody() {
    // account: connected wallet + disconnect
    if (sheet === 'account') {
      return (
        <View style={{ gap: 16 }}>
          <View style={styles.accountRow}>
            <MarkAvatar name={me ?? 'Palm'} size={44} />
            <View style={{ flex: 1 }}>
              <T weight="semibold" size={14}>
                Connected wallet
              </T>
              <T size={12.5} color={palm.inkFaint}>
                {me ? shortKey(me, 6) : '—'}
              </T>
            </View>
            <Chip label="External" />
          </View>
          <T size={12.5} color={palm.inkFaint} style={{ lineHeight: 18 }}>
            Disconnecting removes this wallet from Palm and takes you back to the
            start. Your funds remain safe in the wallet itself.
          </T>
          <Pressable
            onPress={disconnect}
            style={({ pressed }) => [styles.disconnectBtn, { opacity: pressed ? 0.85 : 1 }]}
          >
            <Icon name="unlock" size={15} color={palm.danger} strokeWidth={2.2} />
            <T weight="semibold" size={14} color={palm.danger}>
              Disconnect wallet
            </T>
          </Pressable>
        </View>
      );
    }

    // recipient step (send)
    if (sheet === 'send' && step === 0) {
      return (
        <View style={{ gap: 12 }}>
          <T size={12.5} color={palm.inkFaint}>
            Who receives it? Only the two of you will ever see this payment.
          </T>
          <TextInput
            value={recipient}
            onChangeText={setRecipient}
            placeholder="Private address (base58 pubkey)"
            placeholderTextColor={palm.inkGhost}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
          <PrimaryButton
            title="Continue"
            onPress={() => {
              try {
                new PublicKey(recipient.trim());
                setStep(1);
              } catch {
                showToast('That doesn’t look like a valid address.');
              }
            }}
            style={{ opacity: recipient.trim() ? 1 : 0.45 }}
          />
        </View>
      );
    }

    // name step (create)
    if (sheet === 'create' && step === 0) {
      return (
        <View style={{ gap: 14 }}>
          <T size={12.5} color={palm.inkFaint} style={{ lineHeight: 19 }}>
            Name your agent. It only ever sees its own pocket — never your balance.
          </T>
          <TextInput
            value={vName}
            onChangeText={setVName}
            placeholder="Agent name"
            placeholderTextColor={palm.inkGhost}
            style={styles.input}
          />
          <PrimaryButton title="Continue" onPress={() => vName && setStep(1)} style={{ opacity: vName ? 1 : 0.45 }} />
        </View>
      );
    }

    // amount step (add / send.1 / sendlink.0 / withdraw.0 / create.1 / topup.0)
    const isAmount =
      (sheet === 'add' && step === 0) ||
      (sheet === 'send' && step === 1) ||
      (sheet === 'sendlink' && step === 0) ||
      (sheet === 'withdraw' && step === 0) ||
      (sheet === 'create' && step === 1) ||
      (sheet === 'topup' && step === 0);
    if (isAmount) {
      const captions: Record<string, string> = {
        add: 'Into your shielded balance — visible only to you',
        send: `To ${shortKey(recipient.trim())} · ${formatUsd(balance ?? 0n)} available · arrives in seconds`,
        sendlink: `${formatUsd(balance ?? 0n)} available · anyone with the link can claim it`,
        withdraw: `${formatUsd(balance ?? 0n)} available · takes longer`,
        create: `This becomes ${vName || 'the agent'}’s entire allowance`,
        topup: `From your private balance · ${formatUsd(balance ?? 0n)} available`,
      };
      const btnLabels: Record<string, string> = {
        add: `Add $${amount || '0'}`,
        send: 'Review',
        sendlink: 'Review',
        withdraw: 'Review withdrawal',
        create: 'Set the rules',
        topup: `Top up $${amount || '0'}`,
      };
      const next = () => {
        if (!amtOk) return;
        if (sheet === 'send') setStep(2);
        else if (sheet === 'sendlink') setStep(1);
        else if (sheet === 'withdraw') setStep(1);
        else if (sheet === 'create') {
          setDraft({
            cap: nice(amt * 0.1),
            daily: amt >= 200 ? nice(amt * 0.3) : 0,
            allow: amt >= 500,
            thresh: amt >= 500 ? nice(amt * 0.25) : 0,
          });
          setStep(2);
        } else if (sheet === 'add') doAdd();
        else if (sheet === 'topup') doTopup();
      };
      return (
        <View style={{ gap: 6 }}>
          <View style={{ alignItems: 'center', paddingTop: 8 }}>
            <T weight="bold" size={40} color={amtOk ? palm.ink : palm.inkGhost} style={{ letterSpacing: -0.8 }}>
              ${amount || '0'}
            </T>
            <T size={12.5} color={palm.inkFaint} style={{ marginTop: 6, textAlign: 'center' }}>
              {captions[sheet!] ?? ''}
            </T>
          </View>
          <Keypad onKey={onKey} />
          <PrimaryButton title={btnLabels[sheet!] ?? 'Continue'} onPress={next} style={{ marginTop: 8, opacity: amtOk ? 1 : 0.45 }} />
        </View>
      );
    }

    // confirm step (send.2 / withdraw.1)
    if ((sheet === 'send' && step === 2) || (sheet === 'withdraw' && step === 1)) {
      const isWithdraw = sheet === 'withdraw';
      const rows = isWithdraw
        ? [
            { k: 'Amount', v: formatUsd(usdcBase(amt)) },
            { k: 'To', v: 'Your public address' },
            { k: 'Arrives', v: 'Takes longer' },
          ]
        : [
            { k: 'To', v: shortKey(recipient.trim()) },
            { k: 'Amount', v: formatUsd(usdcBase(amt)) },
            { k: 'Visibility', v: 'Private — only you two' },
            { k: 'Arrives', v: 'In seconds' },
          ];
      return (
        <View style={{ gap: 14 }}>
          <View style={styles.confirmBox}>
            {rows.map((r, i) => (
              <View key={r.k} style={[styles.confirmRow, i < rows.length - 1 && styles.activityDivider]}>
                <T size={13} color={palm.inkFaint}>
                  {r.k}
                </T>
                <T weight="semibold" size={14.5} style={{ textAlign: 'right' }}>
                  {r.v}
                </T>
              </View>
            ))}
          </View>
          {isWithdraw && (
            <View style={styles.warnBox}>
              <Icon name="clock" size={16} color={palm.amber} strokeWidth={2} />
              <T size={12.5} color={palm.amberInk} style={{ flex: 1, lineHeight: 19 }}>
                Withdrawals leave the private pool, so they take longer. You can keep using Palm — we'll notify you when it lands.
              </T>
            </View>
          )}
          <T size={12.5} color={palm.inkFaint} style={{ lineHeight: 19 }}>
            {isWithdraw
              ? 'Heads up: withdrawn funds land on a public address and are no longer shielded.'
              : 'Private sends are final once confirmed.'}
          </T>
          <PrimaryButton
            title={isWithdraw ? `Withdraw ${formatUsd(usdcBase(amt))}` : `Send ${formatUsd(usdcBase(amt))} privately`}
            onPress={isWithdraw ? doWithdraw : doSend}
          />
        </View>
      );
    }

    // send-via-link: optional memo + confirm (sendlink.1)
    if (sheet === 'sendlink' && step === 1) {
      return (
        <View style={{ gap: 14 }}>
          <View style={styles.confirmBox}>
            {[
              { k: 'Amount', v: formatUsd(usdcBase(amt)) },
              { k: 'To', v: 'Anyone with the link' },
              { k: 'Visibility', v: 'Private' },
            ].map((r, i, arr) => (
              <View key={r.k} style={[styles.confirmRow, i < arr.length - 1 && styles.activityDivider]}>
                <T size={13} color={palm.inkFaint}>
                  {r.k}
                </T>
                <T weight="semibold" size={14.5} style={{ textAlign: 'right' }}>
                  {r.v}
                </T>
              </View>
            ))}
          </View>
          <TextInput
            value={memo}
            onChangeText={setMemo}
            placeholder="Add a note (only they can read it)"
            placeholderTextColor={palm.inkGhost}
            autoCapitalize="none"
            style={styles.input}
          />
          <T size={12.5} color={palm.inkFaint} style={{ lineHeight: 19 }}>
            Anyone you send the link to can claim it, so share it privately. If it’s never claimed, the funds stay yours.
          </T>
          <PrimaryButton title={`Create link for ${formatUsd(usdcBase(amt))}`} onPress={doSendLink} />
        </View>
      );
    }

    // claim an incoming link (opened via deep link)
    if (sheet === 'claim') {
      const claimAmt = pendingClaim?.amount;
      return (
        <View style={{ gap: 14 }}>
          <View style={styles.confirmBox}>
            {[
              { k: 'Amount', v: claimAmt != null ? formatUsd(claimAmt) : 'Whatever’s on the link' },
              ...(pendingClaim?.memo ? [{ k: 'Note', v: pendingClaim.memo }] : []),
              { k: 'To', v: 'Your wallet' },
            ].map((r, i, arr) => (
              <View key={r.k} style={[styles.confirmRow, i < arr.length - 1 && styles.activityDivider]}>
                <T size={13} color={palm.inkFaint}>
                  {r.k}
                </T>
                <T weight="semibold" size={14.5} style={{ textAlign: 'right', flexShrink: 1 }}>
                  {r.v}
                </T>
              </View>
            ))}
          </View>
          <T size={12.5} color={palm.inkFaint} style={{ lineHeight: 19 }}>
            Someone sent you a private payment. Claiming moves it into your wallet — you can add it to your private balance afterward.
          </T>
          <PrimaryButton title="Claim it" onPress={doClaim} />
        </View>
      );
    }

    // policy step (create.2 / edit)
    if ((sheet === 'create' && step === 2) || sheet === 'edit') {
      const base = amt || (selVault?.account ? fromUsdc(selVault.account.maxPerTx) * 10 : 100);
      const tier = base >= 500 ? 'large' : base >= 200 ? 'med' : 'small';
      const mkOpts = (fracs: number[], cur: number, key: 'cap' | 'daily' | 'thresh', fmtLabel: (v: number) => string) => {
        const seen = new Set<number>();
        return fracs.map((f) => {
          let v = f === 0 ? 0 : nice(base * f);
          while (v !== 0 && seen.has(v)) v = nice(v * 2.2);
          seen.add(v);
          const sel = cur === v;
          return { v, label: f === 0 ? (key === 'thresh' ? 'Never' : 'None') : fmtLabel(v), sel };
        });
      };
      const capOpts = mkOpts([0.02, 0.05, 0.1, 0.25], draft.cap, 'cap', (v) => fmt0(v));
      const dailyOpts = mkOpts([0, 0.15, 0.3], draft.daily, 'daily', (v) => `${fmt0(v)}/day`);
      const threshOpts = mkOpts([0, 0.15, 0.25], draft.thresh, 'thresh', (v) => fmt0(v));

      const OptRow = ({ opts, onPick }: { opts: { v: number; label: string; sel: boolean }[]; onPick: (v: number) => void }) => (
        <View style={{ flexDirection: 'row', gap: 7 }}>
          {opts.map((o) => (
            <Pressable
              key={o.label}
              onPress={() => onPick(o.v)}
              style={[styles.optBtn, { borderColor: o.sel ? palm.green : palm.border, backgroundColor: o.sel ? palm.greenTintBg : palm.card }]}
            >
              <T weight="bold" size={13.5} color={o.sel ? palm.green : palm.inkSoft}>
                {o.label}
              </T>
            </Pressable>
          ))}
        </View>
      );

      return (
        <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={{ gap: 18 }} showsVerticalScrollIndicator={false}>
          <T size={12.5} color={palm.inkFaint} style={{ lineHeight: 19 }}>
            {sheet === 'edit'
              ? `Changes apply to the next payment ${selVault?.label ?? 'this agent'} tries to make.`
              : `Rules for ${vName || 'this agent'}’s ${formatUsd(usdcBase(amt))}. Start simple — you can tighten or loosen anytime.`}
          </T>

          <View>
            <T weight="bold" size={13} style={{ marginBottom: 8 }}>
              Per-payment cap
            </T>
            <OptRow opts={capOpts} onPick={(v) => setDraft((d) => ({ ...d, cap: v }))} />
          </View>

          {tier !== 'small' && (
            <View>
              <T weight="bold" size={13} style={{ marginBottom: 8 }}>
                Daily limit
              </T>
              <OptRow opts={dailyOpts} onPick={(v) => setDraft((d) => ({ ...d, daily: v }))} />
            </View>
          )}

          {tier === 'large' && (
            <View style={styles.seatbelt}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Icon name="shield" size={14} color={palm.green} strokeWidth={2} />
                <T weight="bold" size={13} color={palm.green}>
                  Seatbelts for larger budgets
                </T>
              </View>
              <Pressable onPress={() => setDraft((d) => ({ ...d, allow: !d.allow }))} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={[styles.toggleTrack, { backgroundColor: draft.allow ? palm.green : '#CBD5CE' }]}>
                  <View style={[styles.toggleKnob, { left: draft.allow ? 19 : 3 }]} />
                </View>
                <View style={{ flex: 1 }}>
                  <T weight="semibold" size={13.5}>
                    Merchant allowlist
                  </T>
                  <T size={12} color={palm.inkDim}>
                    Only recipients you approve. Manage after creation.
                  </T>
                </View>
              </Pressable>
              <View>
                <T weight="semibold" size={13.5} style={{ marginBottom: 8 }}>
                  Ask me above
                </T>
                <OptRow opts={threshOpts} onPick={(v) => setDraft((d) => ({ ...d, thresh: v }))} />
                <T size={11.5} color={palm.inkDim} style={{ marginTop: 7 }}>
                  Payments above this wait for your explicit go-ahead.
                </T>
              </View>
            </View>
          )}

          <PrimaryButton
            title={sheet === 'edit' ? 'Save policy' : `Create agent · fund ${formatUsd(usdcBase(amt))}`}
            onPress={sheet === 'edit' ? doEdit : doCreate}
          />
        </ScrollView>
      );
    }

    // vault detail
    if (sheet === 'vault' && selVault) {
      const v = selVault;
      const name = v.label ?? shortKey(v.agent);
      const rem = Number(v.remainingAllowance);
      const spent = v.account ? Number(v.account.lifetimeSpent) : 0;
      const funded = rem + spent;
      const pct = funded > 0 ? Math.min(100, Math.round((spent / funded) * 100)) : 0;
      const policyRows: { k: string; v: string }[] = [];
      if (v.account) {
        policyRows.push({ k: 'Per-payment cap', v: fmt0(fromUsdc(v.account.maxPerTx)) });
        if (v.account.dailyLimit != null) policyRows.push({ k: 'Daily limit', v: fmt0(fromUsdc(v.account.dailyLimit)) });
        policyRows.push({ k: 'Merchant allowlist', v: v.account.merchantAllowlist ? `On · ${v.account.merchantAllowlist.length}` : 'Off' });
        policyRows.push({ k: 'Approval needed above', v: v.account.approvalThreshold != null ? fmt0(fromUsdc(v.account.approvalThreshold)) : 'Never' });
      }
      return (
        <View style={{ gap: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 13 }}>
            <MarkAvatar name={name} size={48} />
            <View style={{ flex: 1 }}>
              <T weight="bold" size={17}>
                {name}
              </T>
              <T size={12.5} color={palm.inkFaint}>
                agent {shortKey(v.agent)}
              </T>
            </View>
          </View>

          {v.account && (
            <View style={styles.vaultDark}>
              <T weight="semibold" size={11.5} color={palm.onDarkDim} style={{ letterSpacing: 0.6 }}>
                LEFT TO SPEND
              </T>
              <T weight="bold" size={30} color={palm.onDark} style={{ marginTop: 6 }}>
                {formatUsd(v.remainingAllowance)}
              </T>
              <View style={styles.vaultDarkTrack}>
                <View style={{ width: `${pct}%`, backgroundColor: 'rgba(255,255,255,0.32)' }} />
                <View style={{ flex: 1, backgroundColor: palm.mint, marginLeft: 2, borderRadius: 3 }} />
              </View>
              <T size={12} color={palm.onDarkDim} style={{ marginTop: 8 }}>
                spent {formatUsd(usdcBase(spent))} of {formatUsd(usdcBase(funded))} · {v.account.paymentCount} payments
              </T>
            </View>
          )}

          {policyRows.length > 0 && (
            <View style={styles.confirmBox}>
              {policyRows.map((p, i) => (
                <View key={p.k} style={[styles.confirmRow, i < policyRows.length - 1 && styles.activityDivider]}>
                  <T size={13} color={palm.inkFaint}>
                    {p.k}
                  </T>
                  <T weight="semibold" size={13.5}>
                    {p.v}
                  </T>
                </View>
              ))}
            </View>
          )}

          <View style={{ flexDirection: 'row', gap: 9 }}>
            <PrimaryButton
              title="Top up"
              onPress={() => {
                setSheet('topup');
                setStep(0);
                setAmount('');
              }}
              style={{ flex: 1, paddingVertical: 13 }}
            />
            <OutlineButton
              title="Edit policy"
              onPress={() => {
                if (!v.account) return;
                setDraft({
                  cap: Math.round(fromUsdc(v.account.maxPerTx)),
                  daily: v.account.dailyLimit != null ? Math.round(fromUsdc(v.account.dailyLimit)) : 0,
                  allow: !!v.account.merchantAllowlist,
                  thresh: v.account.approvalThreshold != null ? Math.round(fromUsdc(v.account.approvalThreshold)) : 0,
                });
                setSheet('edit');
                setStep(0);
              }}
              style={{ flex: 1, paddingVertical: 13 }}
            />
          </View>

          {!revokeAsk ? (
            <Pressable onPress={() => setRevokeAsk(true)} style={styles.revokeBtn}>
              <T weight="bold" size={14} color={palm.danger}>
                Revoke — pull all funds back
              </T>
            </Pressable>
          ) : (
            <View style={styles.revokeConfirm}>
              <T weight="bold" size={14} color={palm.danger}>
                Pull back {formatUsd(v.remainingAllowance)} to your balance?
              </T>
              <T size={12.5} color={palm.dangerInk} style={{ marginTop: 5, lineHeight: 19 }}>
                {name} loses access instantly. This can't be undone — but you can always create a new agent.
              </T>
              <View style={{ flexDirection: 'row', gap: 9, marginTop: 13 }}>
                <OutlineButton title="Keep agent" onPress={() => setRevokeAsk(false)} style={{ flex: 1, paddingVertical: 11 }} />
                <Pressable onPress={doRevoke} style={styles.revokeNow}>
                  <T weight="bold" size={13} color={palm.onDark}>
                    Revoke now
                  </T>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      );
    }

    return null;
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palm.screen },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 10,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 24 },

  // account sheet
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: palm.card,
    borderWidth: 1,
    borderColor: palm.border,
    borderRadius: 16,
    padding: 14,
  },
  disconnectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: palm.dangerBg,
    borderWidth: 1,
    borderColor: palm.dangerBorder,
    borderRadius: 14,
    paddingVertical: 14,
  },

  // balance
  balanceCard: {
    backgroundColor: palm.greenDeep,
    borderRadius: 22,
    paddingHorizontal: 22,
    paddingTop: 22,
    paddingBottom: 20,
  },
  unlockPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 14,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
    alignSelf: 'flex-start',
  },

  // actions
  actionBtn: { flex: 1, alignItems: 'center', gap: 8 },
  actionIcon: {
    width: 52,
    height: 52,
    borderRadius: 18,
    backgroundColor: palm.card,
    borderWidth: 1,
    borderColor: palm.border,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // activity
  onlyYou: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: palm.greenTintBg,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  activityCard: {
    overflow: 'hidden',
  },
  activityRow: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingHorizontal: 16, paddingVertical: 13 },
  activityDivider: { borderBottomWidth: 1, borderBottomColor: palm.hairline },
  activityIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  transit: { backgroundColor: palm.amberBg, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, marginTop: 3 },

  // agents
  newVaultBtn: { backgroundColor: palm.green, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10 },
  lockedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: palm.greenDeep,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  emptyCard: { height: 250, alignItems: 'center', justifyContent: 'center' },
  vaultCard: { backgroundColor: palm.card, borderWidth: 1, borderColor: palm.border, borderRadius: 20, padding: 18 },
  progressTrack: { height: 7, borderRadius: 4, backgroundColor: '#E9EFEA', overflow: 'hidden', flexDirection: 'row' },

  // links + segmented controls
  segmented: { flexDirection: 'row', gap: 6, backgroundColor: '#EBEFEC', borderRadius: 999, padding: 4 },
  segItem: { flex: 1, borderRadius: 999, paddingVertical: 9, alignItems: 'center' },
  segItemOn: { backgroundColor: palm.card },
  emptyIcon: { width: 52, height: 52, borderRadius: 18, backgroundColor: '#EBEFEC', alignItems: 'center', justifyContent: 'center' },
  reqCard: { borderWidth: 1, borderRadius: 18, padding: 16 },
  reqTag: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  newLinkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderColor: palm.green,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },

  // nav
  nav: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: palm.border,
    backgroundColor: palm.cardAlt,
    paddingTop: 6,
    paddingBottom: 6,
    paddingHorizontal: 8,
  },
  navItem: { flex: 1, alignItems: 'center', gap: 3, paddingVertical: 6 },
  navBadge: {
    position: 'absolute',
    top: 2,
    right: '28%',
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#B3372F',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },

  // toast
  toast: {
    position: 'absolute',
    bottom: 84,
    left: 24,
    right: 24,
    backgroundColor: palm.notif,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },

  // sheet bodies
  input: {
    borderWidth: 1.5,
    borderColor: palm.border,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    fontFamily: 'InstrumentSans_500Medium',
    color: palm.ink,
    backgroundColor: palm.cardAlt,
  },
  suggChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  confirmBox: { backgroundColor: palm.cardAlt, borderWidth: 1, borderColor: palm.borderSoft, borderRadius: 16, paddingHorizontal: 16 },
  confirmRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 11 },
  warnBox: { flexDirection: 'row', gap: 11, backgroundColor: palm.amberBg, borderRadius: 14, padding: 14 },
  optBtn: { flex: 1, borderWidth: 1.5, borderRadius: 12, paddingVertical: 11, alignItems: 'center' },
  seatbelt: { backgroundColor: '#F2F7F3', borderRadius: 16, padding: 15, gap: 15 },
  toggleTrack: { width: 40, height: 24, borderRadius: 12, justifyContent: 'center' },
  toggleKnob: { position: 'absolute', top: 3, width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff' },
  vaultDark: { backgroundColor: palm.greenDeep, borderRadius: 18, padding: 18 },
  vaultDarkTrack: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.16)', overflow: 'hidden', flexDirection: 'row', marginTop: 14 },
  revokeBtn: { borderWidth: 1, borderColor: palm.dangerBorder, backgroundColor: palm.dangerBg, borderRadius: 999, paddingVertical: 14, alignItems: 'center' },
  revokeConfirm: { backgroundColor: palm.dangerBg, borderWidth: 1, borderColor: palm.dangerBorder, borderRadius: 16, padding: 16 },
  revokeNow: { flex: 1.3, backgroundColor: palm.danger, borderRadius: 999, paddingVertical: 11, alignItems: 'center' },
});
