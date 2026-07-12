/**
 * Onboarding — Palm flow: Welcome → Connect a wallet → Unlock your private
 * account (sign) → Add first funds. Wired to the real WalletContext:
 *   connect  → connectWallet()  (Mobile Wallet Adapter authorize + cache)
 *   unlock   → authenticate()   (wallet signature → TEE auth + registry)
 *   fund     → deposit()        (delegates + shields a first deposit)
 *
 * "Unlock your private account" is a bottom sheet that slides up over the
 * welcome screen once a wallet is connected — a single signature to get in,
 * not account creation.
 *
 * Resumable: the sheet always starts closed, so a returning (or sheet-dismissed)
 * user lands back on the welcome screen. Tapping "Connect wallet" re-opens the
 * sheet when a wallet is already connected; an authed user skips to the fund step.
 */
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Dimensions, Easing, ScrollView, StyleSheet, Pressable, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Defs, RadialGradient, Stop, Rect as SvgRect, Circle as SvgCircle } from 'react-native-svg';
import { useWallet } from '../context/WalletContext';
import { deposit, getPublicUsdcBalance } from '../lib/actions';
import { fromUsdc, formatUsd } from '../lib/format';
import { addActivity } from '../lib/activity';
import { ensureRegistered } from '../lib/relay';
import { T, PrimaryButton, GhostButton, Logo, Sheet, SheetStatus } from '../components/palm';
import { Icon, type IconName } from '../components/icons';
import { palm, font } from '../theme';

// Amount is chosen as a share of the wallet balance, or a custom figure.
type Mode = 'p25' | 'p50' | 'p100' | 'custom';
const PCT: Record<Exclude<Mode, 'custom'>, number> = { p25: 25, p50: 50, p100: 100 };
const SHARES: { mode: Exclude<Mode, 'custom'>; label: string }[] = [
  { mode: 'p25', label: '25%' },
  { mode: 'p50', label: '50%' },
  { mode: 'p100', label: 'Max' },
];
// "$1,234", "$2.50" — cents only when the amount has them.
const fmtAmt = (n: number) =>
  '$' + n.toLocaleString('en-US', { minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 });

// Welcome-screen geometry.
const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const GLOW_CY = SCREEN_H * 0.42;

/** The things Palm keeps private — each with its own icon, rolled in the hero. */
const ITEMS: { word: string; icon: IconName }[] = [
  { word: 'agents', icon: 'agents' },
  { word: 'payments', icon: 'send' },
  { word: 'privacy', icon: 'shield' },
];

/** Backdrop on a white field: a faint green glow + one subtle ring. */
function WelcomeBackdrop() {
  return (
    <Svg width={SCREEN_W} height={SCREEN_H} style={StyleSheet.absoluteFill}>
      <Defs>
        <RadialGradient id="wglow" cx="50%" cy="42%" r="62%">
          <Stop offset="0" stopColor={palm.green} stopOpacity="0.07" />
          <Stop offset="1" stopColor={palm.green} stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <SvgRect x={0} y={0} width={SCREEN_W} height={SCREEN_H} fill="url(#wglow)" />
      <SvgCircle cx={SCREEN_W / 2} cy={GLOW_CY} r={230} stroke={palm.green} strokeOpacity={0.09} strokeWidth={1.5} fill="none" />
    </Svg>
  );
}

/**
 * Hero roller — an icon + word slides up and out while the next slides up and
 * in (fade + spring), clipped to a single line.
 */
function RollingItem({ items, interval = 1700 }: { items: typeof ITEMS; interval?: number }) {
  const [i, setI] = useState(0);
  const y = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const id = setInterval(() => {
      Animated.parallel([
        Animated.timing(y, { toValue: -26, duration: 260, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start(() => {
        setI((prev) => (prev + 1) % items.length);
        y.setValue(28);
        Animated.parallel([
          Animated.spring(y, { toValue: 0, friction: 7, tension: 80, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 1, duration: 300, useNativeDriver: true }),
        ]).start();
      });
    }, interval);
    return () => clearInterval(id);
  }, [items.length, interval, y, opacity]);

  const it = items[i];
  return (
    <View style={styles.itemMask}>
      <Animated.View style={[styles.itemRow, { opacity, transform: [{ translateY: y }] }]}>
        <View style={styles.itemIcon}>
          <Icon name={it.icon} size={26} color={palm.green} strokeWidth={2} />
        </View>
        <T size={22} color={palm.green} numberOfLines={1}>
          {it.word}
        </T>
      </Animated.View>
    </View>
  );
}

/**
 * Shielding loader — a shield core with green ripples radiating outward, on a
 * loop. Echoes the welcome screen's ring motif; reads as "funds being sealed
 * into the private balance" rather than a generic spinner.
 */
function ShieldPulse() {
  const rings = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;

  useEffect(() => {
    const loops = rings.map((r) =>
      Animated.loop(
        Animated.timing(r, {
          toValue: 1,
          duration: 2200,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        { resetBeforeIteration: true },
      ),
    );
    // Stagger the ripples so they emanate continuously.
    const timers = loops.map((l, i) => setTimeout(() => l.start(), i * 733));
    return () => {
      timers.forEach(clearTimeout);
      loops.forEach((l) => l.stop());
    };
  }, [rings]);

  return (
    <View style={styles.pulseWrap}>
      {rings.map((r, i) => (
        <Animated.View
          key={i}
          style={[
            styles.pulseRing,
            {
              opacity: r.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0] }),
              transform: [{ scale: r.interpolate({ inputRange: [0, 1], outputRange: [0.65, 2.3] }) }],
            },
          ]}
        />
      ))}
      <View style={styles.pulseCore}>
        <Icon name="shieldCheck" size={34} color={palm.onDark} strokeWidth={2} />
      </View>
    </View>
  );
}

export function OnboardingScreen() {
  const w = useWallet();

  // An authed returning user (with a live wallet) lands on funding; everyone
  // else starts at welcome.
  const [step, setStep] = useState(w.authed && w.signer ? 3 : 0);
  // Protect sheet — starts closed. It's opened by the "Connect wallet" CTA, so a
  // returning (or sheet-dismissed) user always lands back on the welcome screen.
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [connecting, setConnecting] = useState(false);
  // How much to add — a share of the wallet balance (25/50/100%) or a typed
  // custom amount. The dollar figure is derived from the live balance.
  const [mode, setMode] = useState<Mode>('p50');
  const [customStr, setCustomStr] = useState('');
  // The wallet's spendable USDC on the base layer (the pool a deposit draws
  // from). null while we're still reading it; a bigint once known.
  const [walletBase, setWalletBase] = useState<bigint | null>(null);
  const [checking, setChecking] = useState(false);
  // Subtle pop on the hero amount when a different share is chosen.
  const amtPop = useRef(new Animated.Value(1)).current;

  const err = (e: unknown) => Alert.alert('Something went wrong', (e as Error).message);

  // Disconnecting (signOut) drops the signer and clears auth — always return to
  // the welcome step and close the protect sheet, so a fresh connect starts clean.
  useEffect(() => {
    if (!w.signer && !w.authed) {
      setStep(0);
      setUnlockOpen(false);
    }
  }, [w.signer, w.authed]);

  // ── funding amount (a share of the live balance) ────────────────────────────
  const walletUsd = walletBase == null ? null : fromUsdc(walletBase);
  // Floor to whole cents so a percentage never rounds above the real balance.
  const shareOf = (pct: number) =>
    walletUsd == null ? 0 : pct === 100 ? walletUsd : Math.floor((walletUsd * pct) / 100 * 100) / 100;
  const customAmount = parseFloat(customStr) || 0;
  const fundPick =
    mode === 'custom' ? customAmount : shareOf(PCT[mode]);
  const hasEnough = walletUsd != null && fundPick > 0 && fundPick <= walletUsd + 1e-9;
  // Empty wallet — nothing to shield, so the amount controls are inert.
  const noFunds = walletUsd === 0;
  // The wallet can't cover the chosen amount — nudge them to fund it.
  const short = walletUsd != null && !hasEnough;

  // Read the public USDC balance whenever we land on the fund step.
  useEffect(() => {
    if (step !== 3 || !w.signer) return;
    let alive = true;
    setWalletBase(null);
    getPublicUsdcBalance(w.signer.publicKey)
      .then((b) => alive && setWalletBase(b))
      .catch(() => alive && setWalletBase(0n));
    return () => {
      alive = false;
    };
  }, [step, w.signer]);

  const pop = () => {
    amtPop.setValue(0.94);
    Animated.spring(amtPop, { toValue: 1, useNativeDriver: true, friction: 6, tension: 140 }).start();
  };
  const chooseMode = (m: Mode) => {
    setMode(m);
    if (m !== 'custom') pop();
  };
  const onCustomChange = (t: string) => {
    setMode('custom');
    // digits + a single decimal point, max two decimal places
    setCustomStr(t.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1').replace(/(\.\d\d).+/, '$1'));
  };

  const recheckBalance = async () => {
    if (!w.signer || checking) return;
    setChecking(true);
    try {
      setWalletBase(await getPublicUsdcBalance(w.signer.publicKey));
    } catch {
      /* leave the last known balance in place */
    } finally {
      setChecking(false);
    }
  };


  // Welcome CTA. First tap connects an installed wallet via Mobile Wallet Adapter
  // — the OS presents the chooser of wallets on the device — then slides up the
  // protect sheet to sign. If a wallet is already connected (returning user, or
  // they dismissed the sheet), the tap just re-opens the sheet — no reconnect.
  const startConnect = async () => {
    if (connecting) return;
    if (w.signer) {
      setUnlockOpen(true);
      return;
    }
    setConnecting(true);
    try {
      await w.connectWallet();
      setUnlockOpen(true);
    } catch (e) {
      // A user-dismissed wallet sheet throws; don't alarm them for a cancel.
      if (!/cancel|declin|dismiss/i.test((e as Error).message)) err(e);
    } finally {
      setConnecting(false);
    }
  };

  // Sign inside the protect sheet, then reveal the fund step.
  const signToUnlock = async () => {
    setBusy(true);
    try {
      await w.authenticate();
      if (w.publicKey) await ensureRegistered(w.publicKey).catch(() => {});
      setUnlockOpen(false);
      setStep(3);
    } catch (e) {
      err(e);
    } finally {
      setBusy(false);
    }
  };

  const fund = async () => {
    if (!w.signer || !hasEnough) return;
    setBusy(true);
    try {
      await deposit(w.signer, fundPick);
      await addActivity({ kind: 'in', title: 'Added funds', amount: fundPick });
      await w.advanceStep('done');
      // balance is fetched by the PalmShell's react-query hooks once mounted
    } catch (e) {
      err(e);
    } finally {
      setBusy(false);
    }
  };

  const skip = () => w.advanceStep('done').catch(err);

  const seg = (on: boolean) => (on ? palm.green : '#DCE2DE');

  // ── step 0 · welcome (white field, subtle green rings) ──
  const welcome = (
    <View style={styles.welcomeRoot}>
      <WelcomeBackdrop />

      <SafeAreaView style={styles.welcomeSafe} edges={['top', 'bottom']}>
        {/* brand lockup */}
        <View style={styles.wTop}>
          <Logo size={30} />
          <T weight="bold" size={17} color={palm.ink}>
            Palm
          </T>
        </View>

        {/* hero */}
        <View style={styles.wHero}>
          <T weight="bold" size={35} color={palm.ink} style={styles.headline}>
            Your onchain <T weight="bold" size={35} color={palm.green}>privacy</T> control center
          </T>
          <RollingItem items={ITEMS} />
        </View>

        {/* cta — connects a wallet (or re-opens the sheet if already connected) */}
        <View style={styles.wBottom}>
          <PrimaryButton title="Connect wallet" loading={connecting} onPress={startConnect} />
        </View>
      </SafeAreaView>
    </View>
  );

  return (
    <View style={styles.rootWrap}>
      {step === 0 ? (
        welcome
      ) : (
        <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            {/* progress */}
            <View style={{ gap: 8, marginBottom: 8 }}>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                <View style={[styles.segBar, { backgroundColor: seg(step >= 1) }]} />
                <View style={[styles.segBar, { backgroundColor: seg(step >= 2) }]} />
                <View style={[styles.segBar, { backgroundColor: seg(step >= 3) }]} />
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                {['Connect', 'Unlock', 'Fund'].map((l) => (
                  <T key={l} weight="semibold" size={11} color={palm.inkFaint} style={styles.segLabel}>
                    {l.toUpperCase()}
                  </T>
                ))}
              </View>
            </View>

            {/* step 3 · fund */}
            <View style={{ flex: 1, paddingTop: 20 }}>
              {busy ? (
                /* shielding — a focused, branded moment while the deposit lands */
                <View style={styles.fundingWrap}>
                  <ShieldPulse />
                  <View style={{ alignItems: 'center', gap: 7 }}>
                    <T weight="bold" size={19} style={{ letterSpacing: -0.3 }}>
                      Shielding {fmtAmt(fundPick)}
                    </T>
                    <T size={13.5} color={palm.inkFaint} style={{ textAlign: 'center', maxWidth: 288, lineHeight: 20 }}>
                      About 10 seconds. We're moving it into your private balance — nothing here appears on public explorers.
                    </T>
                  </View>
                </View>
              ) : (
                <>
                  <View style={styles.fundHead}>
                    <T weight="bold" size={24} style={{ letterSpacing: -0.5, flex: 1 }}>
                      Add your first funds
                    </T>
                  </View>
                  <T size={14} color={palm.inkDim} style={{ lineHeight: 21, marginBottom: 22 }}>
                    Move money into your private balance to get started — you can always add more later.
                  </T>

                  {/* hero — the amount being added, as a share of the wallet balance */}
                  <View style={styles.fundHero}>
                    <View style={styles.fundHeroTop}>
                      <T weight="semibold" size={12.5} color={palm.onDarkDim} style={{ letterSpacing: 0.6 }}>
                        ADDING TO YOUR BALANCE
                      </T>
                      <Icon name="shield" size={15} color={palm.onDarkDim} strokeWidth={2} />
                    </View>
                    <Animated.View style={{ alignSelf: 'flex-start', marginTop: 14, transform: [{ scale: amtPop }] }}>
                      <T weight="bold" size={46} color={palm.onDark} style={{ letterSpacing: -1 }}>
                        {fmtAmt(fundPick)}
                      </T>
                    </Animated.View>
                    {/* tap to re-read the wallet after topping it up */}
                    <Pressable onPress={recheckBalance} style={styles.heroFoot}>
                      <T size={13} color={palm.onDarkDim} style={{ flex: 1 }}>
                        {walletBase == null ? 'Reading your wallet…' : `of ${formatUsd(walletBase)} in your connected wallet`}
                      </T>
                      <View style={styles.swap18}>
                        {checking ? (
                          <ActivityIndicator size="small" color={palm.onDarkDim} />
                        ) : (
                          <Icon name="repeat" size={14} color={palm.onDarkDim} strokeWidth={2} />
                        )}
                      </View>
                    </Pressable>
                  </View>

                  {/* share of balance — 25% · 50% · Max · Custom (inert when empty) */}
                  <View style={styles.presetRow}>
                    {SHARES.map((s) => {
                      const sel = mode === s.mode;
                      return (
                        <Pressable
                          key={s.mode}
                          disabled={noFunds}
                          onPress={() => chooseMode(s.mode)}
                          style={[styles.preset, sel && styles.presetSel, noFunds && styles.presetOff]}
                        >
                          <T weight="bold" size={15} color={noFunds ? palm.inkGhost : sel ? palm.green : palm.inkSoft}>
                            {s.label}
                          </T>
                        </Pressable>
                      );
                    })}
                    <Pressable
                      disabled={noFunds}
                      onPress={() => chooseMode('custom')}
                      style={[styles.preset, mode === 'custom' && styles.presetSel, noFunds && styles.presetOff]}
                    >
                      <T weight="bold" size={15} color={noFunds ? palm.inkGhost : mode === 'custom' ? palm.green : palm.inkSoft}>
                        Custom
                      </T>
                    </Pressable>
                  </View>

                  {/* custom amount entry */}
                  {mode === 'custom' && !noFunds ? (
                    <View style={[styles.customRow, short && styles.customRowErr]}>
                      <T weight="bold" size={20} color={palm.inkFaint}>
                        $
                      </T>
                      <TextInput
                        value={customStr}
                        onChangeText={onCustomChange}
                        keyboardType="decimal-pad"
                        placeholder="0.00"
                        placeholderTextColor={palm.inkGhost}
                        autoFocus
                        style={styles.customInput}
                      />
                      <Pressable onPress={() => setCustomStr(walletUsd == null ? '' : String(walletUsd))} hitSlop={8}>
                        <T weight="semibold" size={13} color={palm.green}>
                          Max
                        </T>
                      </Pressable>
                    </View>
                  ) : null}

                  {/* short balance — a plain heads-up, no faucet flow */}
                  {short ? (
                    <View style={styles.shortNote}>
                      <Icon name="wallet" size={16} color={palm.amber} strokeWidth={2} />
                      <T size={12.5} color={palm.amberInk} style={{ flex: 1, lineHeight: 18 }}>
                        {walletUsd === 0
                          ? 'Your wallet has no USDC — add funds to your public wallet to continue, or skip for now.'
                          : `That's more than your ${formatUsd(walletBase!)} balance — lower the amount, top up your wallet, or skip for now.`}
                      </T>
                    </View>
                  ) : null}

                  <View style={{ flex: 1, minHeight: 16 }} />

                  <View style={{ gap: 10 }}>
                    <PrimaryButton
                      title={hasEnough ? `Add ${fmtAmt(fundPick)} & finish` : 'Fund your wallet to continue'}
                      onPress={fund}
                      disabled={!hasEnough}
                    />
                    <GhostButton title="Skip for now" onPress={skip} />
                  </View>
                </>
              )}
            </View>
          </ScrollView>
        </SafeAreaView>
      )}

      {/* unlock · sign to access the private account (slides up after connect) */}
      <Sheet
        visible={unlockOpen}
        title="Unlock your private account"
        onClose={() => {
          if (!busy) setUnlockOpen(false);
        }}
      >
        {busy ? (
          <SheetStatus
            kind="busy"
            title="Verifying your signature"
            caption="Your wallet signature is being verified."
          />
        ) : (
          <View style={{ gap: 22, paddingTop: 4, paddingBottom: 6 }}>
            <T size={14} color={palm.inkDim} style={{ lineHeight: 21, paddingBottom: 28 }}>
              A single wallet signature proves this shielded space is yours, that's all it takes to get in. This is just a signature. No funds involved.
            </T>
            <PrimaryButton title="Sign to unlock" onPress={signToUnlock} />
          </View>
        )}
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palm.screen },
  scroll: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 20, paddingBottom: 28 },
  segBar: { flex: 1, height: 4, borderRadius: 2 },
  segLabel: { letterSpacing: 0.5 },
  // ── welcome (white field, subtle green rings) ──
  rootWrap: { flex: 1, backgroundColor: palm.screen },
  welcomeRoot: { flex: 1, backgroundColor: palm.screen },
  welcomeSafe: { flex: 1, paddingHorizontal: 24, paddingTop: 8, paddingBottom: 24 },
  wTop: { flexDirection: 'row', alignItems: 'center', gap: 9, alignSelf: 'center', paddingVertical: 6 },
  wHero: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headline: { textAlign: 'center', letterSpacing: -0.9, lineHeight: 40, maxWidth: 330 },
  wBottom: { gap: 14 },

  // ── hero rolling item (icon + word) ──
  itemMask: { alignSelf: 'stretch', height: 52, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', marginTop: 60 },
  itemRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  itemIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: palm.greenTintBg,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── fund step (echoes the private balance card) ──
  fundHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  // Fixed slot so swapping the spinner for the icon never shifts layout.
  swap18: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  reloadBtn: {
    width: 34,
    height: 34,
    borderRadius: 11,
    backgroundColor: palm.fill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fundHero: {
    backgroundColor: palm.greenDeep,
    borderRadius: 22,
    paddingHorizontal: 22,
    paddingTop: 20,
    paddingBottom: 22,
  },
  fundHeroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heroFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  presetRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 16,
  },
  preset: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: palm.border,
    backgroundColor: palm.card,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
  },
  presetSel: {
    borderColor: palm.green,
    backgroundColor: palm.greenTintBg,
  },
  presetOff: {
    borderColor: palm.borderSoft,
    backgroundColor: palm.fill,
  },

  // ── custom amount entry ──
  customRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: palm.green,
    backgroundColor: palm.card,
  },
  customRowErr: {
    borderColor: palm.dangerBorder,
  },
  customInput: {
    flex: 1,
    fontFamily: font.bold,
    fontSize: 20,
    color: palm.ink,
    paddingVertical: 0,
  },
  shortNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 14,
    padding: 14,
    borderRadius: 14,
    backgroundColor: palm.amberBg,
    borderWidth: 1,
    borderColor: palm.amberBgStrong,
  },

  // ── shielding loader ──
  fundingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 20, paddingBottom: 40 },
  pulseWrap: { width: 200, height: 200, alignItems: 'center', justifyContent: 'center' },
  pulseRing: {
    position: 'absolute',
    width: 108,
    height: 108,
    borderRadius: 54,
    borderWidth: 1.5,
    borderColor: palm.green,
  },
  pulseCore: {
    width: 84,
    height: 84,
    borderRadius: 26,
    backgroundColor: palm.greenDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
