import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Brand, formatGbp } from '@/constants/brand';
import type { CreditKind, CreditTransaction } from '@/context/InThaRouteContext';

const C = Brand.colors;

/** The same kinds and wording as the web Credits pages. */
export const CREDIT_KIND: Record<
  CreditKind,
  { label: string; icon: keyof typeof Ionicons.glyphMap; bg: string; fg: string }
> = {
  purchase: { label: 'Card payment', icon: 'card-outline', bg: C.successSoft, fg: C.success },
  grant: { label: 'Free credits', icon: 'gift-outline', bg: C.infoSoft, fg: C.info },
  adjustment: { label: 'Adjustment', icon: 'construct-outline', bg: C.warningSoft, fg: C.warning },
  delivery: { label: 'Delivery', icon: 'bicycle-outline', bg: C.surfaceAlt, fg: C.ink2 },
};

/** "19 Nov, 14:05" */
export const creditWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

const shortName = (n: string) => (n ?? '').split(' - ')[0];

/**
 * One line of credit activity. `admin` shows which merchant it belongs to and who made a
 * manual change; the merchant sees their own note instead.
 */
export function CreditActivityRow({ t, admin = false }: { t: CreditTransaction; admin?: boolean }) {
  const meta = CREDIT_KIND[t.kind];
  const what =
    t.kind === 'delivery'
      ? `Delivery${t.externalOrderId ? ` ${t.externalOrderId}` : ''}`
      : admin
        ? t.kind === 'purchase'
          ? 'Payment'
          : meta.label
        : t.note || meta.label;
  const details = [
    creditWhen(t.createdAt),
    t.kind === 'purchase' && t.amountPaidGbp != null ? `paid ${formatGbp(t.amountPaidGbp)}${admin ? ' · successful' : ''}` : '',
    admin ? (t.note && t.kind !== 'purchase' ? t.note : '') : t.kind === 'delivery' && t.note ? t.note : '',
    admin && t.kind === 'adjustment' && t.createdByName ? `by ${t.createdByName}` : '',
  ].filter(Boolean);
  const plus = t.credits >= 0;
  return (
    <View style={styles.row}>
      <View style={[styles.icon, { backgroundColor: meta.bg }]}>
        <Ionicons name={meta.icon} size={17} color={meta.fg} />
      </View>
      <View style={styles.text}>
        <Text style={styles.title} numberOfLines={1}>
          {admin ? `${shortName(t.restaurantName)} · ${what}` : what}
        </Text>
        <Text style={styles.sub} numberOfLines={1}>
          {details.join(' · ')}
        </Text>
      </View>
      <Text style={[styles.amount, { color: plus ? C.success : C.ink }]}>
        {plus ? '+' : '−'}
        {Math.abs(t.credits).toFixed(2)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, minWidth: 0, gap: 2 },
  title: { ...Brand.type.bodyStrong, color: C.ink },
  sub: { ...Brand.type.caption, color: C.ink3 },
  amount: { ...Brand.type.bodyStrong, fontVariant: ['tabular-nums'] },
});
