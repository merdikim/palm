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
import { Alert, Animated, Dimensions, Easing, ScrollView, StyleSheet, Pressable, View } from 'react-native';
import { ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Defs, RadialGradient, Stop, Rect as SvgRect, Circle as SvgCircle } from 'react-native-svg';
import { useWallet } from '../context/WalletContext';
import { deposit } from '../lib/actions';
import { addActivity } from '../lib/activity';
import { ensureRegistered } from '../lib/relay';
import { T, PrimaryButton, GhostButton, Logo, Sheet, SheetStatus } from '../components/palm';
import { Icon, type IconName } from '../components/icons';
import { palm } from '../theme';

const FUND_OPTS = [100, 500, 1000];
const fmt0 = (n: number) => '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });

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

export function OnboardingScreen() {
  const w = useWallet();

  // An authed returning user lands on funding; everyone else starts at welcome.
  const [step, setStep] = useState(w.authed ? 3 : 0);
  // Protect sheet — starts closed. It's opened by the "Connect wallet" CTA, so a
  // returning (or sheet-dismissed) user always lands back on the welcome screen.
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [fundPick, setFundPick] = useState(500);

  const err = (e: unknown) => Alert.alert('Something went wrong', (e as Error).message);

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
    if (!w.signer) return;
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
            <View style={{ flex: 1, paddingTop: 24 }}>
              <T weight="bold" size={24} style={{ letterSpacing: -0.5, marginBottom: 8 }}>
                Add your first funds
              </T>
              <T size={14} color={palm.inkDim} style={{ lineHeight: 21, marginBottom: 26 }}>
                Money moves into your shielded balance. From here on, only you can see it.
              </T>
              <View style={{ flexDirection: 'row', gap: 10, marginBottom: 20 }}>
                {FUND_OPTS.map((v) => {
                  const sel = fundPick === v;
                  return (
                    <Pressable
                      key={v}
                      onPress={() => setFundPick(v)}
                      style={[
                        styles.fundOpt,
                        {
                          borderColor: sel ? palm.green : palm.border,
                          backgroundColor: sel ? palm.greenTintBg : palm.card,
                        },
                      ]}
                    >
                      <T weight="bold" size={16} color={sel ? palm.green : palm.inkSoft}>
                        {fmt0(v)}
                      </T>
                    </Pressable>
                  );
                })}
              </View>
              {busy && (
                <View style={styles.fundBusy}>
                  <ActivityIndicator color={palm.green} />
                  <T size={13.5} color={palm.inkDim}>
                    Moving {fmt0(fundPick)} into your private balance…
                  </T>
                </View>
              )}
              <View style={{ flex: 1 }} />
              {!busy && (
                <View style={{ gap: 10 }}>
                  <PrimaryButton title={`Add ${fmt0(fundPick)} & finish`} onPress={fund} />
                  <GhostButton title="Skip for now" onPress={skip} />
                </View>
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
  bigWord: { letterSpacing: -0.8 },

  // ── protect sheet shield ──
  protectShield: {
    width: 96,
    height: 96,
    borderRadius: 28,
    backgroundColor: palm.greenDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fundOpt: {
    flex: 1,
    borderWidth: 1.5,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  fundBusy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: palm.card,
    borderWidth: 1,
    borderColor: palm.border,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
});
