import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
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
/* Layout                                                                      */
/* -------------------------------------------------------------------------- */

export function Screen({
  children,
  contentStyle,
}: {
  children: React.ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
}) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.screenContent,
        { paddingBottom: insets.bottom + 32 },
        contentStyle,
      ]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}>
      {children}
    </ScrollView>
  );
}

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
}: {
  icon: IconName;
  onPress?: () => void;
  tone?: 'neutral' | 'white';
  size?: number;
}) {
  return (
    <Pressable
      onPress={onPress}
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
}: {
  value: string;
  onDecrement: () => void;
  onIncrement: () => void;
}) {
  return (
    <View style={styles.stepper}>
      <Pressable onPress={onDecrement} hitSlop={6} style={styles.stepperBtn}>
        <Ionicons name="remove" size={16} color={C.ink} />
      </Pressable>
      <Text style={styles.stepperValue} numberOfLines={1}>
        {value}
      </Text>
      <Pressable onPress={onIncrement} hitSlop={6} style={styles.stepperBtn}>
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

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput placeholderTextColor={C.ink3} style={styles.fieldInput} {...props} />
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
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.sheetRoot}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={styles.sheetBackdrop} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle} numberOfLines={1}>
              {title}
            </Text>
            <IconButton icon="close" onPress={onClose} size={34} />
          </View>
          {children}
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
  fieldInput: {
    height: 50,
    borderRadius: Brand.radius.md,
    backgroundColor: C.surfaceAlt,
    paddingHorizontal: 14,
    ...Brand.type.body,
    color: C.ink,
  },

  sheetRoot: { flex: 1, justifyContent: 'flex-end' },
  sheetBackdrop: { ...StyleSheet.absoluteFill, backgroundColor: C.overlay },
  sheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: Brand.radius.xl,
    borderTopRightRadius: Brand.radius.xl,
    paddingHorizontal: 20,
    paddingTop: 8,
    gap: 16,
    maxHeight: '88%',
  },
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
