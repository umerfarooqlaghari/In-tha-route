import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';

import { Brand } from '@/constants/brand';
import { AREA_CENTER, LatLng } from '@/constants/geo';

export type MapPinKind = 'pickup' | 'dropoff' | 'driver' | 'restaurant';

export interface MapPin {
  id: string;
  coordinate: LatLng;
  kind: MapPinKind;
  label?: string;
  active?: boolean;
}

interface LiveMapProps {
  pins: MapPin[];
  route?: LatLng[];
  style?: ViewStyle;
  /** Extra bottom padding so pins are not hidden behind a bottom sheet */
  bottomInset?: number;
  topInset?: number;
  interactive?: boolean;
}

const PIN_META: Record<MapPinKind, { color: string; icon: keyof typeof Ionicons.glyphMap }> = {
  pickup: { color: Brand.colors.ink, icon: 'restaurant' },
  restaurant: { color: Brand.colors.ink, icon: 'storefront' },
  dropoff: { color: Brand.colors.primary, icon: 'home' },
  driver: { color: Brand.colors.info, icon: 'navigate' },
};

function Pin({ pin }: { pin: MapPin }) {
  const meta = PIN_META[pin.kind];
  if (pin.kind === 'driver') {
    return (
      <View style={styles.driverHalo}>
        <View style={styles.driverDot}>
          <Ionicons name="navigate" size={12} color="#FFFFFF" />
        </View>
      </View>
    );
  }
  return (
    <View style={styles.pinWrap}>
      <View
        style={[
          styles.pin,
          { backgroundColor: meta.color },
          pin.active && styles.pinActive,
        ]}>
        {pin.label ? (
          <Text style={styles.pinLabel}>{pin.label}</Text>
        ) : (
          <Ionicons name={meta.icon} size={13} color="#FFFFFF" />
        )}
      </View>
      <View style={[styles.pinTail, { borderTopColor: meta.color }]} />
    </View>
  );
}

export function LiveMap({
  pins,
  route,
  style,
  bottomInset = 0,
  topInset = 0,
  interactive = true,
}: LiveMapProps) {
  const mapRef = useRef<MapView>(null);

  const coords = useMemo(() => {
    const all = pins.map((p) => p.coordinate);
    return all.length ? all : [AREA_CENTER];
  }, [pins]);

  const fitKey = coords.map((c) => `${c.latitude.toFixed(4)},${c.longitude.toFixed(4)}`).join('|');

  useEffect(() => {
    const timer = setTimeout(() => {
      if (coords.length > 1) {
        mapRef.current?.fitToCoordinates(coords, {
          edgePadding: { top: 60 + topInset, right: 48, bottom: 48 + bottomInset, left: 48 },
          animated: true,
        });
      }
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, bottomInset, topInset]);

  return (
    <View style={[styles.container, style]}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        mapType="mutedStandard"
        initialRegion={{
          latitude: coords[0].latitude,
          longitude: coords[0].longitude,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        }}
        showsPointsOfInterests={false}
        showsBuildings={false}
        showsCompass={false}
        toolbarEnabled={false}
        pitchEnabled={false}
        rotateEnabled={false}
        scrollEnabled={interactive}
        zoomEnabled={interactive}>
        {route && route.length > 1 && (
          <Polyline
            coordinates={route}
            strokeColor={Brand.colors.ink}
            strokeWidth={4}
            lineCap="round"
            lineJoin="round"
          />
        )}
        {pins.map((pin) => (
          <Marker
            key={pin.id}
            coordinate={pin.coordinate}
            anchor={{ x: 0.5, y: pin.kind === 'driver' ? 0.5 : 1 }}
            tracksViewChanges={false}>
            <Pin pin={pin} />
          </Marker>
        ))}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    backgroundColor: Brand.colors.surfaceAlt,
  },
  pinWrap: {
    alignItems: 'center',
  },
  pin: {
    minWidth: 28,
    height: 28,
    paddingHorizontal: 6,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  pinActive: {
    transform: [{ scale: 1.15 }],
  },
  pinLabel: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  pinTail: {
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderTopWidth: 6,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    marginTop: -1,
  },
  driverHalo: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(47, 111, 237, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  driverDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Brand.colors.info,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
