/**
 * Onboarding — Palm flow: Welcome → Connect a wallet → Create your private
 * account (sign) → Add first funds. Wired to the real WalletContext:
 *   connect  → createWallet()  (local ed25519 key in secure store)
 *   protect  → authenticate()  (TEE auth challenge + registry)
 *   fund     → deposit()       (delegates + shields a first deposit)
 *
 * Resumable: the initial step is derived from persisted wallet state, so a
 * killed/backgrounded app resumes where it left off.
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
import { T, PrimaryButton, GhostButton, Logo, MarkAvatar } from '../components/palm';
import { Icon, type IconName } from '../components/icons';
import { palm } from '../theme';

const WALLETS = [
  { name: 'Nova Wallet', sub: 'Detected on this device' },
  { name: 'KeyRing', sub: 'Mobile wallet' },
  { name: 'Hardware device', sub: 'Connect over USB or NFC' },
];
const FUND_OPTS = [100, 500, 1000];
const fmt0 = (n: number) => '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });

// Welcome-screen geometry + iris-close transition scale.
const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const GLOW_CY = SCREEN_H * 0.42;
const IRIS_BASE = 220;
const IRIS_FINAL = (Math.hypot(SCREEN_W, SCREEN_H) * 1.2) / IRIS_BASE;

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

  const initialStep = (() => {
    if (!w.signer) return 0;
    if (!w.authed) return 2;
    return 3;
  })();

  const [step, setStep] = useState(initialStep);
  const [busy, setBusy] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [fundPick, setFundPick] = useState(500);

  // welcome → connect: a green "logo circle" irises closed over the screen,
  // step 1 is swapped in underneath, then the circle irises back open.
  const [closing, setClosing] = useState(false);
  const iris = useRef(new Animated.Value(0)).current; // 0 → 1 (cover) → 2 (reveal)
  const goNext = () => {
    if (closing) return;
    setClosing(true);
    iris.setValue(0);
    Animated.timing(iris, { toValue: 1, duration: 500, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(
      ({ finished }) => {
        if (!finished) return;
        setStep(1);
        Animated.timing(iris, { toValue: 2, duration: 460, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(
          () => {
            setClosing(false);
            iris.setValue(0);
          },
        );
      },
    );
  };

  const err = (e: unknown) => Alert.alert('Something went wrong', (e as Error).message);

  const connect = async (name: string) => {
    if (connecting) return;
    setConnecting(name);
    try {
      await w.createWallet();
      setStep(2);
    } catch (e) {
      err(e);
    } finally {
      setConnecting(null);
    }
  };

  const protectAccount = async () => {
    setBusy(true);
    try {
      await w.authenticate();
      if (w.publicKey) await ensureRegistered(w.publicKey).catch(() => {});
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

  // ── step 0 · welcome (white field, subtle green rings, wheel picker) ──
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

        {/* cta */}
        <View style={styles.wBottom}>
          <PrimaryButton title="Get started" onPress={goNext} />
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
        {step > 0 && (
          <View style={{ gap: 8, marginBottom: 8 }}>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              <View style={[styles.segBar, { backgroundColor: seg(step >= 1) }]} />
              <View style={[styles.segBar, { backgroundColor: seg(step >= 2) }]} />
              <View style={[styles.segBar, { backgroundColor: seg(step >= 3) }]} />
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              {['Connect', 'Protect', 'Fund'].map((l) => (
                <T key={l} weight="semibold" size={11} color={palm.inkFaint} style={styles.segLabel}>
                  {l.toUpperCase()}
                </T>
              ))}
            </View>
          </View>
        )}

        {/* step 1 · connect */}
        {step === 1 && (
          <View style={{ flex: 1, paddingTop: 24 }}>
            <T weight="bold" size={24} style={{ letterSpacing: -0.5, marginBottom: 8 }}>
              Connect a wallet
            </T>
            <T size={14} color={palm.inkDim} style={{ lineHeight: 21, marginBottom: 24 }}>
              Your wallet stays yours. Palm only asks it to sign — never to hand over keys.
            </T>
            <View style={{ gap: 10 }}>
              {WALLETS.map((wal) => (
                <Pressable key={wal.name} onPress={() => connect(wal.name)} style={styles.walletRow}>
                  <MarkAvatar name={wal.name} size={38} />
                  <View style={{ flex: 1 }}>
                    <T weight="semibold" size={15}>
                      {wal.name}
                    </T>
                    <T size={12.5} color={palm.inkFaint}>
                      {wal.sub}
                    </T>
                  </View>
                  {connecting === wal.name && <ActivityIndicator color={palm.green} />}
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {/* step 2 · protect */}
        {step === 2 && (
          <View style={{ flex: 1, paddingTop: 24 }}>
            <T weight="bold" size={24} style={{ letterSpacing: -0.5, marginBottom: 8 }}>
              Create your private account
            </T>
            <T size={14} color={palm.inkDim} style={{ lineHeight: 21, marginBottom: 28 }}>
              One signature proves this shielded space is yours. Nothing here will appear on public explorers.
            </T>
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              {busy ? (
                <View style={{ alignItems: 'center', gap: 18 }}>
                  <View style={styles.protectBusy}>
                    <ActivityIndicator color={palm.green} size="large" />
                  </View>
                  <View style={{ alignItems: 'center' }}>
                    <T weight="semibold" size={15}>
                      Confirming on-chain
                    </T>
                    <T size={12.5} color={palm.inkFaint} style={{ marginTop: 4, textAlign: 'center' }}>
                      About 10 seconds. Safe to leave — we'll pick up where you left off.
                    </T>
                  </View>
                </View>
              ) : (
                <View style={styles.protectShield}>
                  <Icon name="shieldCheck" size={52} color="#DFF0E8" strokeWidth={1.8} />
                </View>
              )}
            </View>
            {!busy && <PrimaryButton title="Sign & protect my account" onPress={protectAccount} />}
          </View>
        )}

        {/* step 3 · fund */}
        {step === 3 && (
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
        )}
        </ScrollView>
        </SafeAreaView>
      )}

      {/* iris-close: a green "logo circle" wipes between welcome and step 1 */}
      {closing && (
        <View pointerEvents="none" style={styles.irisWrap}>
          <Animated.View
            style={[
              styles.iris,
              { transform: [{ scale: iris.interpolate({ inputRange: [0, 1, 2], outputRange: [0.001, IRIS_FINAL, 0.001] }) }] },
            ]}
          />
        </View>
      )}
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

  // ── iris-close transition (green logo circle) ──
  irisWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', marginTop: -(SCREEN_H * 0.08) },
  iris: {
    width: IRIS_BASE,
    height: IRIS_BASE,
    borderRadius: IRIS_BASE / 2,
    backgroundColor: palm.greenDeep,
  },
  walletRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: palm.card,
    borderWidth: 1,
    borderColor: palm.border,
    borderRadius: 16,
    padding: 16,
  },
  protectBusy: {
    width: 72,
    height: 72,
    borderRadius: 22,
    backgroundColor: palm.greenTintBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  protectShield: {
    width: 130,
    height: 130,
    borderRadius: 36,
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
