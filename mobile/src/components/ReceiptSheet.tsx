import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';

import { Sheet } from '@/components/ui';
import { API_URL } from '@/constants/api';
import { Brand } from '@/constants/brand';
import { LiveOrder } from '@/context/InThaRouteContext';
import { getAccessToken } from '@/services/apiClient';

const C = Brand.colors;

/**
 * The photo of the receipt an order was scanned from.
 * `as` is who is looking: a restaurant only ever gets its own orders' photos,
 * and a driver only those of the orders in their current run.
 */
export type ReceiptViewer = 'restaurant' | 'admin' | 'driver';

export function ReceiptSheet({
  order,
  as,
  onClose,
}: {
  order: LiveOrder | null;
  as: ReceiptViewer;
  onClose: () => void;
}) {
  return (
    <Sheet visible={!!order} onClose={onClose} title={order ? `Receipt ${order.externalOrderId}`.trim() : ''}>
      {order && <ReceiptPhoto key={order.id} orderId={order.id} as={as} />}
    </Sheet>
  );
}

/** Fetched with the signed-in user's token; the photo is never public. */
function ReceiptPhoto({ orderId, as }: { orderId: string; as: ReceiptViewer }) {
  const [token, setToken] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getAccessToken()
      .then((t) => !cancelled && setToken(t))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  return (
    <View style={styles.wrap}>
      {failed ? (
        <Text style={styles.muted}>The receipt photo couldn’t be loaded.</Text>
      ) : token ? (
        <Image
          style={styles.photo}
          resizeMode="contain"
          accessibilityLabel="Receipt photo"
          onError={() => setFailed(true)}
          source={{
            uri: `${API_URL}/api/${as}/orders/${orderId}/receipt`,
            headers: { Authorization: `Bearer ${token}` },
          }}
        />
      ) : (
        <ActivityIndicator color={C.primary} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', minHeight: 200 },
  photo: { width: '100%', height: 460, borderRadius: Brand.radius.md, backgroundColor: C.surfaceAlt },
  muted: { ...Brand.type.caption, color: C.ink3 },
});
