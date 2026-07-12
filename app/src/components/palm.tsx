/**
 * Palm shared UI primitives — themed text, buttons, chips, the deterministic
 * agent "mark" avatar, and the bottom-sheet shell. Everything renders in the
 * Palm light palette with Instrument Sans.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Easing,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type TextProps,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { palm, font } from '../theme';
import { Icon } from './icons';

// ── Text ────────────────────────────────────────────────────────────────────
type Weight = 'regular' | 'medium' | 'semibold' | 'bold';
const familyFor = (w: Weight) => font[w];

export function T({
  weight = 'regular',
  color = palm.ink,
  size = 14,
  style,
  children,
  ...rest
}: TextProps & { weight?: Weight; color?: string; size?: number }) {
  return (
    <Text
      style={[{ fontFamily: familyFor(weight), color, fontSize: size }, style]}
      {...rest}
    >
      {children}
    </Text>
  );
}

// ── Logo ─────────────────────────────────────────────────────────────────────
export function Logo({ size = 28 }: { size?: number }) {
  const ring = Math.round(size * 0.43);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.32,
        backgroundColor: palm.greenDeep,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <View
        style={{
          width: ring,
          height: ring,
          borderRadius: ring / 2,
          borderWidth: Math.max(2, size * 0.07),
          borderColor: '#EAF4EE',
        }}
      />
    </View>
  );
}

// ── Buttons ──────────────────────────────────────────────────────────────────
export function PrimaryButton({
  title,
  onPress,
  loading,
  disabled,
  style,
}: {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.primary,
        { opacity: disabled ? 0.45 : pressed ? 0.9 : 1 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={palm.onDark} />
      ) : (
        <T weight="semibold" color={palm.onDark} size={15.5}>
          {title}
        </T>
      )}
    </Pressable>
  );
}

export function GhostButton({
  title,
  onPress,
  color = palm.inkDim,
  style,
}: {
  title: string;
  onPress: () => void;
  color?: string;
  style?: ViewStyle;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.ghost, { opacity: pressed ? 0.6 : 1 }, style]}>
      <T weight="semibold" color={color} size={14}>
        {title}
      </T>
    </Pressable>
  );
}

export function OutlineButton({
  title,
  onPress,
  style,
}: {
  title: string;
  onPress: () => void;
  style?: ViewStyle;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.outline, { opacity: pressed ? 0.7 : 1 }, style]}>
      <T weight="semibold" color={palm.ink} size={13.5}>
        {title}
      </T>
    </Pressable>
  );
}

// ── Chip ─────────────────────────────────────────────────────────────────────
export function Chip({
  label,
  bg = palm.fill,
  fg = palm.inkSoft,
}: {
  label: string;
  bg?: string;
  fg?: string;
}) {
  return (
    <View style={[styles.chip, { backgroundColor: bg }]}>
      <T weight="semibold" color={fg} size={11}>
        {label}
      </T>
    </View>
  );
}

// ── Deterministic mark (agent / contact avatar) ──────────────────────────────
export interface Mark {
  tint: string;
  fg: string;
  inner: ViewStyle;
}
export function markFor(name: string): Mark {
  const h = [...String(name || '?')].reduce((a, c) => a + c.charCodeAt(0), 0);
  const i = h % 4;
  const inner: ViewStyle = { transform: [{ rotate: `${palm.markRots[i]}deg` }] };
  if (i === 1) inner.borderRadius = 99;
  else if (i === 3) {
    inner.borderTopLeftRadius = 10;
    inner.borderTopRightRadius = 10;
    inner.borderBottomRightRadius = 10;
    inner.borderBottomLeftRadius = 3;
  } else inner.borderRadius = 3;
  return { tint: palm.markTints[i], fg: palm.markFgs[i], inner };
}

export function MarkAvatar({ name, size = 44 }: { name: string; size?: number }) {
  const m = markFor(name);
  const inner = Math.round(size * 0.36);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.32,
        backgroundColor: m.tint,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <View style={[{ width: inner, height: inner, backgroundColor: m.fg }, m.inner]} />
    </View>
  );
}

/** Circle avatar with an initial (contacts). */
export function InitialAvatar({
  initial,
  name,
  size = 36,
}: {
  initial: string;
  name: string;
  size?: number;
}) {
  const m = markFor(name);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.33,
        backgroundColor: m.tint,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <T weight="bold" color={m.fg} size={14}>
        {initial}
      </T>
    </View>
  );
}

// ── Bottom sheet ─────────────────────────────────────────────────────────────
export function Sheet({
  visible,
  title,
  onClose,
  canBack,
  onBack,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  canBack?: boolean;
  onBack?: () => void;
  children: React.ReactNode;
}) {
  // Pad the sheet clear of the system nav bar / gesture area at the bottom.
  const insets = useSafeAreaInsets();
  // Keep the Modal mounted through the exit animation so the sheet can slide
  // back down (rather than vanishing) when `visible` flips to false.
  const [mounted, setMounted] = useState(visible);
  // Off-screen travel distance — the sheet's own measured height, falling back
  // to the window height until the first layout pass.
  const sheetH = useRef(Dimensions.get('window').height);
  const y = useRef(new Animated.Value(sheetH.current)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      y.setValue(sheetH.current);
      Animated.parallel([
        Animated.spring(y, { toValue: 0, useNativeDriver: true, damping: 26, stiffness: 260, mass: 0.9 }),
        Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(y, { toValue: sheetH.current, duration: 240, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
  }, [visible, y, opacity]);

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.sheetRoot}>
        <Animated.View style={[styles.backdrop, { opacity }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        </Animated.View>
        <Animated.View
          style={[
            styles.sheet,
            { paddingBottom: 30 + insets.bottom, transform: [{ translateY: y }] },
          ]}
          onLayout={(e) => {
            const h = e.nativeEvent.layout.height;
            if (h > 0) sheetH.current = h;
          }}
        >
          <View style={styles.grabber} />
          <View style={styles.sheetHead}>
            {canBack ? (
              <Pressable onPress={onBack} style={styles.headBtn}>
                <T size={15} color={palm.inkSoft}>
                  ←
                </T>
              </Pressable>
            ) : null}
            <T weight="bold" size={17} style={{ flex: 1 }}>
              {title}
            </T>
            <Pressable onPress={onClose} style={styles.headBtn}>
              <T size={15} color={palm.inkSoft}>
                ✕
              </T>
            </Pressable>
          </View>
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

/** Masks sensitive numbers when the balance is locked (blur equivalent). */
export function Secret({
  locked,
  w = 80,
  h = 16,
  dark = false,
  children,
}: {
  locked: boolean;
  w?: number;
  h?: number;
  dark?: boolean;
  children?: React.ReactNode;
}) {
  if (!locked) return <>{children}</>;
  return (
    <View
      style={{
        width: w,
        height: h,
        borderRadius: 6,
        backgroundColor: dark ? 'rgba(255,255,255,0.18)' : palm.fill,
      }}
    />
  );
}

/** 3×4 numeric keypad used by the amount sheets. */
export function Keypad({ onKey }: { onKey: (k: string) => void }) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'];
  return (
    <View style={styles.keypad}>
      {keys.map((k) => (
        <Pressable
          key={k}
          onPress={() => onKey(k)}
          style={({ pressed }) => [styles.key, pressed && { backgroundColor: '#E3EDE6' }]}
        >
          <T weight="semibold" size={21} color={palm.ink}>
            {k}
          </T>
        </Pressable>
      ))}
    </View>
  );
}

/** Centered busy / done state used inside sheets. */
export function SheetStatus({
  kind,
  title,
  caption,
  onDone,
}: {
  kind: 'busy' | 'done';
  title: string;
  caption: string;
  onDone?: () => void;
}) {
  return (
    <View style={{ alignItems: 'center', gap: 16, paddingVertical: 22 }}>
      <View
        style={{
          width: 60,
          height: 60,
          borderRadius: 20,
          backgroundColor: kind === 'done' ? palm.green : palm.greenTintBg,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {kind === 'busy' ? (
          <ActivityIndicator color={palm.green} />
        ) : (
          <Icon name="check" color={palm.onDark} size={26} strokeWidth={2.6} />
        )}
      </View>
      <View style={{ alignItems: 'center', gap: 5 }}>
        <T weight="bold" size={15.5}>
          {title}
        </T>
        <T size={13} color={palm.inkFaint} style={{ textAlign: 'center', maxWidth: 270, lineHeight: 19 }}>
          {caption}
        </T>
      </View>
      {kind === 'done' && onDone ? (
        <Pressable onPress={onDone} style={styles.doneBtn}>
          <T weight="semibold" size={14} color={palm.ink}>
            Done
          </T>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  primary: {
    backgroundColor: palm.green,
    borderRadius: 999,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghost: { paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  outline: {
    borderWidth: 1,
    borderColor: palm.border,
    backgroundColor: palm.card,
    borderRadius: 999,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  sheetRoot: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(8,22,16,0.45)' },
  sheet: {
    backgroundColor: palm.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 22,
    paddingTop: 14,
    paddingBottom: 30,
    maxHeight: '86%',
  },
  grabber: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#DCE2DE',
    alignSelf: 'center',
    marginBottom: 12,
  },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  headBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: palm.fill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneBtn: {
    backgroundColor: palm.fill,
    borderRadius: 999,
    paddingHorizontal: 28,
    paddingVertical: 12,
  },
  keypad: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 },
  key: {
    width: '33.33%',
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
  },
});
