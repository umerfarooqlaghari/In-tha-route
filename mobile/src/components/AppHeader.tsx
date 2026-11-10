import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar, IconButton } from '@/components/ui';
import { Brand } from '@/constants/brand';
import { PERSONAS } from '@/constants/personas';
import { useChat } from '@/context/ChatContext';
import { ROLE_SCREENS, useInThaRoute } from '@/context/InThaRouteContext';

const C = Brand.colors;

export function AppHeader() {
  const insets = useSafeAreaInsets();
  const { role, activeScreen, user } = useInThaRoute();
  const { unreadTotal } = useChat();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const screen = ROLE_SCREENS[role].find((s) => s.key === activeScreen) ?? ROLE_SCREENS[role][0];
  const persona = PERSONAS[role];

  const topPad = Math.max(insets.top, 48) + 12;

  return (
    <>
        <View style={[styles.header, { paddingTop: topPad }]}>
          <View>
            <IconButton icon="menu" onPress={() => setDrawerOpen(true)} />
            {unreadTotal > 0 && <View style={styles.menuDot} pointerEvents="none" />}
          </View>
          <View style={styles.titleWrap}>
            <Text style={styles.title} numberOfLines={1}>
              {screen.title}
            </Text>
            <Text style={styles.subtitle} numberOfLines={1}>
              {persona.label}
            </Text>
          </View>
          <Pressable onPress={() => setDrawerOpen(true)} hitSlop={8}>
            <Avatar name={user?.fullName ?? persona.name} tone="primary" size={40} />
          </Pressable>
        </View>
        <Drawer visible={drawerOpen} onClose={() => setDrawerOpen(false)} />
      </>
      );
}

      function Drawer({visible, onClose}: {visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
      const {width} = useWindowDimensions();
      const drawerWidth = Math.min(320, width * 0.84);
      const {role, activeScreen, setActiveScreen, logout, user, screens} = useInThaRoute();
      const {unreadTotal} = useChat();
      const persona = PERSONAS[role];
      const profileName = user?.fullName ?? persona.name;
      const profileOrg = user ? user.restaurant?.name ?? persona.label : persona.org;

      const translateX = useRef(new Animated.Value(-drawerWidth)).current;
      const fade = useRef(new Animated.Value(0)).current;
      const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) {
        setMounted(true);
      Animated.parallel([
      Animated.timing(translateX, {
        toValue: 0,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
        }),
      Animated.timing(fade, {toValue: 1, duration: 220, useNativeDriver: true }),
      ]).start();
    } else if (mounted) {
        Animated.parallel([
          Animated.timing(translateX, {
            toValue: -drawerWidth,
            duration: 200,
            easing: Easing.in(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(fade, { toValue: 0, duration: 200, useNativeDriver: true }),
        ]).start(() => setMounted(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const go = (key: string) => {
        setActiveScreen(key);
      onClose();
  };

      return (
      <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose}>
        <Animated.View style={[styles.backdrop, { opacity: fade }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        </Animated.View>

        <Animated.View
          style={[
            styles.drawer,
            {
              width: drawerWidth,
              paddingTop: Math.max(insets.top, 48) + 20,
              paddingBottom: Math.max(insets.bottom, 20) + 16,
              transform: [{ translateX }],
            },
          ]}>
          {/* Profile */}
          <View style={styles.profile}>
            <Avatar name={profileName} tone="primary" size={52} />
            <View style={styles.profileText}>
              <Text style={styles.profileName} numberOfLines={1}>
                {profileName}
              </Text>
              <Text style={styles.profileOrg} numberOfLines={1}>
                {profileOrg}
              </Text>
            </View>
          </View>

          {/* Navigation */}
          <View style={styles.nav}>
            {screens.map((s) => {
              const active = s.key === activeScreen;
              return (
                <Pressable
                  key={s.key}
                  onPress={() => go(s.key)}
                  style={({ pressed }) => [
                    styles.navItem,
                    active && styles.navItemActive,
                    pressed && !active && styles.navItemPressed,
                  ]}>
                  <Ionicons
                    name={s.icon as keyof typeof Ionicons.glyphMap}
                    size={22}
                    color={active ? C.primary : C.ink2}
                  />
                  <View style={styles.navText}>
                    <Text
                      style={[styles.navTitle, active && styles.navTitleActive]}
                      numberOfLines={1}>
                      {s.title}
                    </Text>
                    <Text style={styles.navSubtitle} numberOfLines={1}>
                      {s.subtitle}
                    </Text>
                  </View>
                  {s.key === 'messages' && unreadTotal > 0 && (
                    <View style={styles.navBadge}>
                      <Text style={styles.navBadgeText}>{unreadTotal > 99 ? '99+' : unreadTotal}</Text>
                    </View>
                  )}
                </Pressable>
              );
            })}
          </View>

          <View style={styles.spacer} />

          <Pressable
            onPress={() => {
              onClose();
              logout();
            }}
            style={({ pressed }) => [styles.logout, pressed && styles.navItemPressed]}>
            <Ionicons name="log-out-outline" size={22} color={C.ink2} />
            <Text style={styles.logoutText}>Log out</Text>
          </Pressable>
        </Animated.View>
      </Modal>
      );
}

      const styles = StyleSheet.create({
        header: {
        flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 16,
      paddingBottom: 12,
      backgroundColor: C.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: C.line,
  },
      titleWrap: {flex: 1, minWidth: 0, alignItems: 'center' },
      title: {...Brand.type.heading, color: C.ink },
      subtitle: {fontSize: 12, color: C.ink3, marginTop: 1 },

      backdrop: {...StyleSheet.absoluteFill, backgroundColor: C.overlay },
      drawer: {
        position: 'absolute',
      top: 0,
      bottom: 0,
      left: 0,
      backgroundColor: C.surface,
      paddingHorizontal: 16,
      borderTopRightRadius: Brand.radius.xl,
      borderBottomRightRadius: Brand.radius.xl,
      ...Brand.shadow.floating,
  },
      profile: {
        flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 4,
      paddingBottom: 20,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: C.line,
  },
      profileText: {flex: 1, minWidth: 0 },
      profileName: {...Brand.type.heading, color: C.ink },
      profileOrg: {...Brand.type.caption, color: C.ink3, marginTop: 2 },
      nav: {paddingTop: 12, gap: 4 },
      navItem: {
        flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      paddingHorizontal: 12,
      paddingVertical: 12,
      borderRadius: Brand.radius.md,
  },
      navItemActive: {backgroundColor: C.primarySoft },
      navItemPressed: {backgroundColor: C.surfaceAlt },
      navText: {flex: 1, minWidth: 0 },
      navTitle: {...Brand.type.bodyStrong, color: C.ink },
      navTitleActive: {color: C.primary },
      navSubtitle: {fontSize: 12, color: C.ink3, marginTop: 1 },
      spacer: {flex: 1 },
      logout: {
        flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      paddingHorizontal: 12,
      paddingVertical: 12,
      borderRadius: Brand.radius.md,
  },
      logoutText: {...Brand.type.bodyStrong, color: C.ink2 },
      menuDot: {
        position: 'absolute',
        top: 6,
        right: 6,
        width: 10,
        height: 10,
        borderRadius: 5,
        backgroundColor: C.primary,
        borderWidth: 2,
        borderColor: C.surface,
      },
      navBadge: {
        minWidth: 22,
        height: 22,
        paddingHorizontal: 6,
        borderRadius: 11,
        backgroundColor: C.primary,
        alignItems: 'center',
        justifyContent: 'center',
      },
      navBadgeText: {color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
});
