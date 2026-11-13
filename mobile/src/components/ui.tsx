import { Ionicons } from '@expo/vector-icons';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  LayoutChangeEvent,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Brand, SOURCE_COLORS, SourceKey } from '@/constants/brand';

type IconName = keyof typeof Ionicons.glyphMap;
const C = Brand.colors;

/* -------------------------------------------------------------------------- */
/* Keyboard                                                                    */
/* -------------------------------------------------------------------------- */

/** Lets a field ask the scroll view it sits in to bring it into view when it takes focus. */
const RevealFieldContext = createContext<() => void>(() => {});

/**
 * Keeps the field being typed in visible inside a scroll view.
 * `reveal(covered)` scrolls just enough to bring the focused field into view;
 * `covered` is how much of the bottom of the scroll view the keyboard hides.
 */
function useRevealFocusedField() {
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const viewport = useRef(0);
  const offset = useRef(0);

  const reveal = useCallback((covered = 0) => {
    const input = TextInput.State.currentlyFocusedInput();
    const content = scroll.current?.getInnerViewRef();
    if (!input || !content) return;
    input.measureLayout(
      content,
      (_x, y, _width, height) => {
        const visible = viewport.current - covered;
        if (visible <= 0) return;
        const top = y - 28; // keeps the label above the field in view
        const bottom = y + height + 16;
        if (bottom > offset.current + visible) {
          scroll.current?.scrollTo({ y: bottom - visible, animated: true });
        } else if (top < offset.current) {
          scroll.current?.scrollTo({ y: Math.max(top, 0), animated: true });
        }
      },
      () => {}, // the focused field is not inside this scroll view
    );
  }, []);

  const onViewport = useCallback((e: LayoutChangeEvent) => {
    viewport.current = e.nativeEvent.layout.height;
  }, []);
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    offset.current = e.nativeEvent.contentOffset.y;
  }, []);

  // How much of the scroll view the keyboard covers right now (set by the owner).
  const covered = useRef(0);
  // Waits for the keyboard and the layout to settle: scrolling earlier is clamped to the old size.
  const revealSoon = useCallback(() => {
    setTimeout(() => reveal(covered.current), 120);
  }, [reveal]);

  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', revealSoon);
    return () => shown.remove();
  }, [revealSoon]);

  const setCovered = useCallback((height: number) => {
    covered.current = height;
  }, []);

  return { scroll, reveal, revealSoon, setCovered, onViewport, onScroll };
}

/**
 * Height of the open keyboard on Android, 0 otherwise. Android draws edge to edge and no longer
 * resizes the window for the keyboard, so a screen has to make room itself. iOS does it natively.
 */
function useAndroidKeyboardHeight() {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const show = Keyboard.addListener('keyboardDidShow', (e) => setHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardDidHide', () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}

/* -------------------------------------------------------------------------- */
/* Layout                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A scrolling page. Tapping an empty spot or dragging the page puts the keyboard away,
 * and the field being typed in is scrolled clear of the keyboard.
 */
export function Screen({
  children,
  contentStyle,
}: {
  children: React.ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
}) {
  const insets = useSafeAreaInsets();
  const { scroll, revealSoon, setCovered, onViewport, onScroll } = useRevealFocusedField();
  const keyboard = useAndroidKeyboardHeight();

  // Android: once the room for the keyboard is in place, bring the focused field above it.
  // iOS moves the focused field itself (automaticallyAdjustKeyboardInsets).
  useEffect(() => {
    setCovered(keyboard > 0 ? keyboard + insets.bottom : 0);
    if (keyboard > 0) revealSoon();
  }, [keyboard, insets.bottom, setCovered, revealSoon]);
  const onFieldFocus = Platform.OS === 'android' ? revealSoon : noop;

  return (
    <RevealFieldContext.Provider value={onFieldFocus}>
      <ScrollView
        ref={scroll}
        style={styles.screen}
        contentContainerStyle={[
          styles.screenContent,
          { paddingBottom: insets.bottom + 32 + keyboard },
          contentStyle,
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets
        onLayout={onViewport}
        onScroll={onScroll}
        scrollEventThrottle={32}
        showsVerticalScrollIndicator={false}>
        {children}
      </ScrollView>
    </RevealFieldContext.Provider>
  );
}

function noop() {}

export function Card({
  children,
  style,
  onPress,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
}) {
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.card, pressed && styles.pressed, style]}>
        {children}
      </Pressable>
    );
  }
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionLabel({ children, right }: { children: string; right?: React.ReactNode }) {
  return (
    <View style={styles.sectionRow}>
      <Text style={styles.sectionLabel} numberOfLines={1}>
        {children}
      </Text>
      {right}
    </View>
  );
}

/** A single short, calm hint line — replaces wordy instruction banners. */
export function Hint({ icon = 'information-circle-outline', children }: { icon?: IconName; children: string }) {
  return (
    <View style={styles.hint}>
      <Ionicons name={icon} size={16} color={C.ink3} />
      <Text style={styles.hintText}>{children}</Text>
    </View>
  );
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.divider, style]} />;
}

/* -------------------------------------------------------------------------- */
/* Buttons                                                                     */
/* -------------------------------------------------------------------------- */

type ButtonVariant = 'primary' | 'dark' | 'secondary' | 'ghost' | 'success';

export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  disabled,
  loading,
  style,
  compact,
}: {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  icon?: IconName;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  compact?: boolean;
}) {
  const palette: Record<ButtonVariant, { bg: string; fg: string; border?: string }> = {
    primary: { bg: C.primary, fg: '#FFFFFF' },
    dark: { bg: C.ink, fg: '#FFFFFF' },
    secondary: { bg: C.surfaceAlt, fg: C.ink },
    ghost: { bg: 'transparent', fg: C.ink, border: C.lineStrong },
    success: { bg: C.success, fg: '#FFFFFF' },
  };
  const p = palette[variant];
  return (
    <Pressable
      disabled={disabled || loading}
      onPress={onPress}
      // Without this VoiceOver also reads the icon's private-use glyph before the label.
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      style={({ pressed }) => [
        styles.button,
        compact && styles.buttonCompact,
        { backgroundColor: p.bg, borderColor: p.border ?? p.bg },
        pressed && styles.pressed,
        (disabled || loading) && styles.disabled,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={p.fg} />
      ) : (
        <>
          {icon && <Ionicons name={icon} size={compact ? 16 : 18} color={p.fg} />}
          <Text
            style={[styles.buttonText, compact && styles.buttonTextCompact, { color: p.fg }]}
            numberOfLines={1}>
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

export function IconButton({
  icon,
  onPress,
  tone = 'neutral',
  size = 40,
  label,
  testID,
}: {
  icon: IconName;
  onPress?: () => void;
  tone?: 'neutral' | 'white';
  size?: number;
  /** Read out by VoiceOver (icon-only buttons have no visible text). */
  label?: string;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label ?? icon}
      testID={testID}
      hitSlop={8}
      style={({ pressed }) => [
        styles.iconButton,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: tone === 'white' ? C.surface : C.surfaceAlt,
        },
        tone === 'white' && Brand.shadow.card,
        pressed && styles.pressed,
      ]}>
      <Ionicons name={icon} size={20} color={C.ink} />
    </Pressable>
  );
}

/* -------------------------------------------------------------------------- */
/* Badges & chips                                                              */
/* -------------------------------------------------------------------------- */

type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'info';
const TONES: Record<Tone, { bg: string; fg: string }> = {
  neutral: { bg: C.surfaceAlt, fg: C.ink2 },
  primary: { bg: C.primarySoft, fg: C.primary },
  success: { bg: C.successSoft, fg: C.success },
  warning: { bg: C.warningSoft, fg: C.warning },
  info: { bg: C.infoSoft, fg: C.info },
};

export function Badge({ label, tone = 'neutral', icon }: { label: string; tone?: Tone; icon?: IconName }) {
  const t = TONES[tone];
  return (
    <View style={[styles.badge, { backgroundColor: t.bg }]}>
      {icon && <Ionicons name={icon} size={12} color={t.fg} />}
      <Text style={[styles.badgeText, { color: t.fg }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

export function SourceBadge({ source }: { source: string }) {
  const color = SOURCE_COLORS[source as SourceKey] ?? C.ink2;
  const label = source === 'Eat Presto POS' ? 'Eat Presto' : source;
  return (
    <View style={styles.sourceBadge}>
      <View style={[styles.sourceDot, { backgroundColor: color }]} />
      <Text style={styles.sourceText} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

export function Chip({
  label,
  selected,
  onPress,
  icon,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: IconName;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!selected }}
      style={({ pressed }) => [
        styles.chip,
        selected && styles.chipSelected,
        pressed && styles.pressed,
      ]}>
      {icon && <Ionicons name={icon} size={14} color={selected ? '#FFFFFF' : C.ink2} />}
      <Text style={[styles.chipText, selected && styles.chipTextSelected]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.segmented}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            style={[styles.segment, active && styles.segmentActive]}>
            <Text
              style={[styles.segmentText, active && styles.segmentTextActive]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.85}>
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Stepper({
  value,
  onDecrement,
  onIncrement,
  name,
}: {
  value: string;
  onDecrement: () => void;
  onIncrement: () => void;
  /** What is being changed, for VoiceOver and tests (e.g. "Restaurant fee"). */
  name?: string;
}) {
  const id = name?.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return (
    <View style={styles.stepper}>
      <Pressable
        onPress={onDecrement}
        hitSlop={6}
        style={styles.stepperBtn}
        accessibilityRole="button"
        accessibilityLabel={name ? `Decrease ${name}` : 'Decrease'}
        testID={id ? `${id}-minus` : undefined}>
        <Ionicons name="remove" size={16} color={C.ink} />
      </Pressable>
      <Text style={styles.stepperValue} numberOfLines={1} testID={id ? `${id}-value` : undefined}>
        {value}
      </Text>
      <Pressable
        onPress={onIncrement}
        hitSlop={6}
        style={styles.stepperBtn}
        accessibilityRole="button"
        accessibilityLabel={name ? `Increase ${name}` : 'Increase'}
        testID={id ? `${id}-plus` : undefined}>
        <Ionicons name="add" size={16} color={C.ink} />
      </Pressable>
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Rows, avatars, stats                                                        */
/* -------------------------------------------------------------------------- */

export function Avatar({ name, tone = 'neutral', size = 40 }: { name: string; tone?: Tone; size?: number }) {
  const t = TONES[tone];
  const initials = name
    .split(' ')
    .map((p) => p.charAt(0))
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <View
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: t.bg },
      ]}>
      <Text style={[styles.avatarText, { color: t.fg, fontSize: size * 0.36 }]}>{initials}</Text>
    </View>
  );
}

export function IconTile({ icon, tone = 'neutral', size = 40 }: { icon: IconName; tone?: Tone; size?: number }) {
  const t = TONES[tone];
  return (
    <View
      style={[
        styles.iconTile,
        { width: size, height: size, borderRadius: size * 0.3, backgroundColor: t.bg },
      ]}>
      <Ionicons name={icon} size={size * 0.48} color={t.fg} />
    </View>
  );
}

export function ListRow({
  left,
  title,
  subtitle,
  right,
  onPress,
  chevron,
}: {
  left?: React.ReactNode;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  onPress?: () => void;
  chevron?: boolean;
}) {
  const content = (
    <>
      {left}
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.rowSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
      {chevron && <Ionicons name="chevron-forward" size={18} color={C.ink3} />}
    </>
  );
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
        {content}
      </Pressable>
    );
  }
  return <View style={styles.row}>{content}</View>;
}

export function Stat({
  label,
  value,
  tone,
  style,
}: {
  label: string;
  value: string;
  tone?: Tone;
  style?: StyleProp<ViewStyle>;
}) {
  const color = tone ? TONES[tone].fg : C.ink;
  return (
    <View style={[styles.stat, style]}>
      <Text style={styles.statLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text
        style={[styles.statValue, { color }]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}>
        {value}
      </Text>
    </View>
  );
}

export function EmptyState({ icon, title, subtitle }: { icon: IconName; title: string; subtitle?: string }) {
  return (
    <View style={styles.empty}>
      <IconTile icon={icon} size={52} />
      <Text style={styles.emptyTitle}>{title}</Text>
      {subtitle ? <Text style={styles.emptySubtitle}>{subtitle}</Text> : null}
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Inputs                                                                      */
/* -------------------------------------------------------------------------- */

export function Field({
  label,
  error,
  ...props
}: TextInputProps & { label: string; error?: string }) {
  const revealField = useContext(RevealFieldContext);
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        placeholderTextColor={C.ink3}
        style={[
          styles.fieldInput,
          props.multiline && styles.fieldInputMultiline,
          !!error && styles.fieldInputError,
        ]}
        {...props}
        onFocus={(e) => {
          revealField();
          props.onFocus?.(e);
        }}
      />
      {!!error && <Text style={styles.fieldError}>{error}</Text>}
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Bottom sheet modal                                                          */
/* -------------------------------------------------------------------------- */

export function Sheet({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const { scroll, revealSoon, onViewport, onScroll } = useRevealFocusedField();

  // With the keyboard open, a tap outside the sheet puts the keyboard away first.
  const tapOutside = () => (Keyboard.isVisible() ? Keyboard.dismiss() : onClose());

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* The keyboard pushes the sheet up and shortens it; what no longer fits scrolls. */}
      <KeyboardAvoidingView style={styles.sheetRoot} behavior="padding">
        <Pressable style={styles.sheetBackdrop} onPress={tapOutside} accessibilityLabel="Close" />
        <View style={styles.sheet}>
          <Pressable style={styles.sheetTop} onPress={Keyboard.dismiss} accessible={false}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle} numberOfLines={1}>
                {title}
              </Text>
              <IconButton icon="close" label="Close" onPress={onClose} size={34} />
            </View>
          </Pressable>
          <ScrollView
            ref={scroll}
            style={styles.sheetScroll}
            contentContainerStyle={[styles.sheetContent, { paddingBottom: insets.bottom + 16 }]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            alwaysBounceVertical={false}
            onLayout={(e) => {
              onViewport(e);
              revealSoon();
            }}
            onScroll={onScroll}
            scrollEventThrottle={32}>
            <RevealFieldContext.Provider value={revealSoon}>{children}</RevealFieldContext.Provider>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* Styles                                                                      */
/* -------------------------------------------------------------------------- */

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  screenContent: { padding: 16, gap: 12 },
  card: {
    backgroundColor: C.surface,
    borderRadius: Brand.radius.lg,
    padding: 16,
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.line,
    ...Brand.shadow.card,
  },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.45 },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    paddingHorizontal: 4,
  },
  sectionLabel: { ...Brand.type.micro, color: C.ink3, textTransform: 'uppercase', flexShrink: 1 },
  hint: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 },
  hintText: { ...Brand.type.caption, color: C.ink3, flex: 1 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: C.line },

  button: {
    minHeight: 52,
    borderRadius: Brand.radius.md,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
  },
  buttonCompact: { minHeight: 40, paddingHorizontal: 14, borderRadius: Brand.radius.sm + 2 },
  buttonText: { ...Brand.type.bodyStrong, flexShrink: 1 },
  buttonTextCompact: { fontSize: 14 },
  iconButton: { alignItems: 'center', justifyContent: 'center' },

  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Brand.radius.pill,
    alignSelf: 'flex-start',
    flexShrink: 0,
  },
  badgeText: { fontSize: 12, fontWeight: '600' },
  sourceBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  sourceDot: { width: 8, height: 8, borderRadius: 4 },
  sourceText: { ...Brand.type.captionStrong, color: C.ink2, flexShrink: 1 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    height: 36,
    borderRadius: Brand.radius.pill,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.lineStrong,
  },
  chipSelected: { backgroundColor: C.ink, borderColor: C.ink },
  chipText: { ...Brand.type.captionStrong, color: C.ink2 },
  chipTextSelected: { color: '#FFFFFF' },
  segmented: {
    flexDirection: 'row',
    backgroundColor: C.surfaceAlt,
    borderRadius: Brand.radius.md,
    padding: 3,
  },
  segment: {
    flex: 1,
    height: 36,
    borderRadius: Brand.radius.sm + 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  segmentActive: { backgroundColor: C.surface, ...Brand.shadow.card },
  segmentText: { ...Brand.type.captionStrong, color: C.ink3 },
  segmentTextActive: { color: C.ink },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surfaceAlt,
    borderRadius: Brand.radius.pill,
    padding: 3,
    flexShrink: 0,
  },
  stepperBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperValue: { ...Brand.type.bodyStrong, color: C.ink, minWidth: 56, textAlign: 'center' },

  avatar: { alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  avatarText: { fontWeight: '700' },
  iconTile: { alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: { ...Brand.type.bodyStrong, color: C.ink },
  rowSubtitle: { ...Brand.type.caption, color: C.ink3 },
  stat: { flex: 1, minWidth: 0, gap: 4 },
  statLabel: { ...Brand.type.caption, color: C.ink3 },
  statValue: { fontSize: 20, fontWeight: '700', letterSpacing: -0.3 },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 28 },
  emptyTitle: { ...Brand.type.heading, color: C.ink, textAlign: 'center' },
  emptySubtitle: { ...Brand.type.caption, color: C.ink3, textAlign: 'center' },

  field: { gap: 6 },
  fieldLabel: { ...Brand.type.captionStrong, color: C.ink2 },
  fieldInputError: { borderWidth: 1, borderColor: C.primary },
  fieldError: { ...Brand.type.caption, color: C.primary },
  fieldInput: {
    height: 50,
    borderRadius: Brand.radius.md,
    backgroundColor: C.surfaceAlt,
    paddingHorizontal: 14,
    ...Brand.type.body,
    color: C.ink,
  },
  fieldInputMultiline: {
    height: undefined,
    minHeight: 50,
    maxHeight: 132,
    paddingTop: 14,
    paddingBottom: 14,
    textAlignVertical: 'top',
  },

  sheetRoot: { flex: 1, justifyContent: 'flex-end' },
  sheetBackdrop: { ...StyleSheet.absoluteFill, backgroundColor: C.overlay },
  sheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: Brand.radius.xl,
    borderTopRightRadius: Brand.radius.xl,
    maxHeight: '88%',
    flexShrink: 1,
    overflow: 'hidden',
  },
  sheetTop: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
    gap: 16,
  },
  sheetScroll: { flexGrow: 0 },
  sheetContent: { paddingHorizontal: 20, gap: 16 },
  sheetHandle: {
    alignSelf: 'center',
    width: 36,
    height: 5,
    borderRadius: 3,
    backgroundColor: C.lineStrong,
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  sheetTitle: { ...Brand.type.title, color: C.ink, flex: 1 },
});
