import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { CreditActivityRow } from '@/components/CreditActivity';
import { Badge, Card, Divider, EmptyState, Screen, SectionLabel } from '@/components/ui';
import { Brand, formatGbp } from '@/constants/brand';
import { CreditSummary, CreditTransaction, useInThaRoute } from '@/context/InThaRouteContext';
import { api } from '@/services/apiClient';

const C = Brand.colors;

/** Credits are bought on the web panel only; the app shows where. */
export const BUY_ON_WEB = 'Buy credits on the In Tha Route website: Merchant → Credits.';

/**
 * Whether there are enough credits to post. With less than one delivery at the merchant's fee,
 * no order can be posted, whoever delivers it (the server checks the same). A platform order also
 * needs enough for its own fee; an order for the merchant's own driver uses none.
 */
export function creditCheck(credits: CreditSummary | null, orderFeeGbp: number) {
  const needed = Math.max(orderFeeGbp, credits?.feePerDeliveryGbp ?? 0);
  const available = credits?.available ?? 0;
  return { enough: !credits || available + 1e-9 >= needed, available, needed };
}

export const isLow = (c: CreditSummary | null) => !!c && c.available + 1e-9 < c.feePerDeliveryGbp;

/** The out-of-credits message on the review and scan screens. */
export function OutOfCredits({ available, needed }: { available: number; needed: number }) {
  const none = available < 1;
  return (
    <View style={styles.out} accessibilityRole="alert">
      <View style={styles.outHead}>
        <View style={styles.outIcon}>
          <Ionicons name="wallet" size={18} color="#FFFFFF" />
        </View>
        <View style={styles.flexText}>
          <Text style={styles.outTitle}>{none ? 'You’re out of credits' : 'Not enough credits'}</Text>
          <Text style={styles.outBody}>
            {none
              ? 'Sorry, this order can’t be posted: you’re out of credits. Buy credits to keep using deliveries.'
              : `Sorry, this order can’t be posted: it needs ${needed.toFixed(2)} credits and you have ${available.toFixed(2)} available. Buy credits to continue.`}
          </Text>
        </View>
      </View>
      <View style={styles.webNote}>
        <Ionicons name="globe-outline" size={15} color={C.ink2} />
        <Text style={styles.webNoteText}>{BUY_ON_WEB}</Text>
      </View>
    </View>
  );
}

/** The balance in the header; red when it can't cover one delivery. Opens the Credits screen. */
export function CreditsPill() {
  const { credits, setActiveScreen } = useInThaRoute();
  if (!credits) return null;
  const low = isLow(credits);
  return (
    <Pressable
      onPress={() => setActiveScreen('credits')}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={`${credits.available.toFixed(2)} credits available. Open credits`}
      style={({ pressed }) => [styles.pill, low && styles.pillLow, pressed && styles.pressed]}>
      <Ionicons name="wallet" size={14} color={low ? '#FFFFFF' : C.warning} />
      <Text style={[styles.pillText, low && styles.pillTextLow]}>{credits.available.toFixed(2)}</Text>
    </Pressable>
  );
}

/** View only: balance, what was bought and used, and the activity. Buying happens on the web. */
export function CreditsScreen() {
  const { credits, dashboardSyncedAt } = useInThaRoute();
  const [tx, setTx] = useState<CreditTransaction[] | null>(null);
  // Activity reloads whenever the balance moves (a delivery charged, a payment, an admin change).
  const version = credits ? `${credits.balance}|${credits.usedCredits}|${credits.addedCredits}` : '';

  useEffect(() => {
    if (!version) return;
    let cancelled = false;
    api<{ transactions: CreditTransaction[] }>('GET', '/api/restaurant/credits')
      .then((r) => !cancelled && setTx(r.transactions))
      .catch(() => !cancelled && setTx((t) => t ?? []));
    return () => {
      cancelled = true;
    };
  }, [version]);

  if (!credits) {
    return (
      <Screen>
        <ActivityIndicator color={C.ink3} style={styles.loading} />
      </Screen>
    );
  }

  const fee = credits.feePerDeliveryGbp;
  const low = isLow(credits);
  const synced = dashboardSyncedAt ? new Date(dashboardSyncedAt) : null;

  return (
    <Screen>
      <View style={styles.hero}>
        <Ionicons name="wallet" size={150} color="rgba(255,255,255,0.08)" style={styles.heroIcon} />
        <Text style={styles.heroLabel}>CREDITS AVAILABLE</Text>
        <Text style={styles.heroValue} adjustsFontSizeToFit numberOfLines={1}>
          {credits.available.toFixed(2)}
        </Text>
        <Text style={styles.heroSub}>
          {credits.deliveriesLeft == null
            ? 'Platform deliveries are free right now.'
            : `≈ ${credits.deliveriesLeft} ${credits.deliveriesLeft === 1 ? 'delivery' : 'deliveries'} left at ${formatGbp(fee)} each`}
        </Text>
        {low && (
          <View style={styles.heroWarn}>
            <Ionicons name="information-circle" size={14} color={C.primary} />
            <Text style={styles.heroWarnText}>Not enough for a delivery. You can’t post orders until you buy credits.</Text>
          </View>
        )}
      </View>

      <Card>
        <View style={styles.grid}>
          <Mini label="Bought & added" value={`+${credits.addedCredits.toFixed(2)}`} green />
          <Mini label="Used" value={`−${credits.usedCredits.toFixed(2)}`} />
          <Mini label="Balance" value={credits.balance.toFixed(2)} />
          <Mini label="Held for live orders" value={credits.held.toFixed(2)} />
          <Mini label="Fee per delivery" value={formatGbp(fee)} badge={credits.customFee ? 'Your rate' : undefined} />
          <Mini label="Deliveries charged" value={String(credits.deliveriesCharged)} />
        </View>
        {credits.paidGbp > 0 && (
          <Text style={styles.muted}>{`Paid by card so far: ${formatGbp(credits.paidGbp)}`}</Text>
        )}
      </Card>

      <Card style={styles.buyCard}>
        <View style={styles.row}>
          <View style={styles.buyIcon}>
            <Ionicons name="globe-outline" size={18} color={C.info} />
          </View>
          <View style={styles.flexText}>
            <Text style={styles.cardTitle}>Buying credits</Text>
            <Text style={styles.muted}>{BUY_ON_WEB} Credits you buy there show here straight away.</Text>
          </View>
        </View>
      </Card>

      <SectionLabel>How credits work</SectionLabel>
      <Card>
        <Rule icon="wallet-outline" color={C.warning} text="1 credit = £1. £100 buys 100 credits." />
        <Rule
          icon="bicycle-outline"
          color={C.primary}
          text={`Each platform delivery uses ${formatGbp(fee)} in credits, taken when it’s delivered.`}
        />
        <Rule
          icon="shield-checkmark-outline"
          color={C.success}
          text="Orders for your own drivers and cancelled orders don’t use credits, but with no credits left you can’t post any order."
        />
      </Card>

      <SectionLabel>Activity</SectionLabel>
      <Card>
        {tx == null ? (
          <ActivityIndicator color={C.ink3} />
        ) : tx.length === 0 ? (
          <EmptyState icon="receipt-outline" title="No activity yet" subtitle="Your payments and deliveries appear here." />
        ) : (
          tx.map((t, i) => (
            <View key={t.id} style={styles.gap12}>
              {i > 0 && <Divider />}
              <CreditActivityRow t={t} />
            </View>
          ))
        )}
      </Card>
      {synced && (
        <Text style={[styles.muted, styles.center]}>
          {`Updated ${synced.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`}
        </Text>
      )}
    </Screen>
  );
}

function Mini({ label, value, badge, green }: { label: string; value: string; badge?: string; green?: boolean }) {
  return (
    <View style={styles.mini}>
      <Text style={styles.miniLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[styles.miniValue, green && { color: C.success }]} numberOfLines={1}>
        {value}
      </Text>
      {badge && <Badge label={badge} tone="info" />}
    </View>
  );
}

function Rule({ icon, color, text }: { icon: keyof typeof Ionicons.glyphMap; color: string; text: string }) {
  return (
    <View style={styles.rule}>
      <Ionicons name={icon} size={18} color={color} />
      <Text style={styles.ruleText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { marginTop: 40 },
  gap12: { gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  flexText: { flex: 1, minWidth: 0, gap: 3 },
  center: { textAlign: 'center' },
  pressed: { opacity: 0.7 },
  cardTitle: { ...Brand.type.bodyStrong, color: C.ink },
  muted: { ...Brand.type.caption, color: C.ink3 },

  hero: {
    overflow: 'hidden',
    padding: 22,
    borderRadius: Brand.radius.lg,
    backgroundColor: C.primary,
    gap: 4,
  },
  heroIcon: { position: 'absolute', right: -24, bottom: -30, transform: [{ rotate: '12deg' }] },
  heroLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 1.6, color: 'rgba(255,255,255,0.75)' },
  heroValue: { fontSize: 48, fontWeight: '800', color: '#FFFFFF', fontVariant: ['tabular-nums'] },
  heroSub: { ...Brand.type.body, color: 'rgba(255,255,255,0.9)' },
  heroWarn: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Brand.radius.pill,
    backgroundColor: '#FFFFFF',
    maxWidth: '100%',
  },
  heroWarnText: { ...Brand.type.captionStrong, color: C.primary, flexShrink: 1 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  mini: { flexBasis: '47%', flexGrow: 1, gap: 4, padding: 12, borderRadius: Brand.radius.md, backgroundColor: C.surfaceAlt, alignItems: 'flex-start' },
  miniLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, color: C.ink3, textTransform: 'uppercase' },
  miniValue: { ...Brand.type.heading, color: C.ink, fontVariant: ['tabular-nums'] },

  buyCard: { backgroundColor: C.infoSoft, borderColor: C.infoSoft },
  buyIcon: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },

  rule: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  ruleText: { ...Brand.type.body, color: C.ink2, flex: 1 },

  out: { gap: 12, padding: 14, borderRadius: Brand.radius.lg, backgroundColor: C.primarySoft, borderWidth: 1, borderColor: C.primaryLine },
  outHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  outIcon: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: C.primary },
  outTitle: { ...Brand.type.bodyStrong, color: C.ink },
  outBody: { ...Brand.type.caption, color: C.ink2 },
  webNote: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 10, backgroundColor: '#FFFFFF' },
  webNoteText: { ...Brand.type.captionStrong, color: C.ink2, flex: 1 },

  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    height: 32,
    borderRadius: Brand.radius.pill,
    backgroundColor: C.warningSoft,
  },
  pillLow: { backgroundColor: C.primary },
  pillText: { ...Brand.type.captionStrong, color: C.ink, fontVariant: ['tabular-nums'] },
  pillTextLow: { color: '#FFFFFF' },
});
