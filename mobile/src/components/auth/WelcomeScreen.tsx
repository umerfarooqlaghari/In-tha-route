import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AuthLayout } from '@/components/auth/AuthLayout';
import { Button, IconTile } from '@/components/ui';
import { Brand } from '@/constants/brand';
import { PERSONAS } from '@/constants/personas';

const C = Brand.colors;

export type SignupRole = 'restaurant' | 'driver';
const SIGNUP_ROLES: SignupRole[] = ['restaurant', 'driver'];

export function WelcomeScreen({
  onSignup,
  onLogin,
}: {
  onSignup: (role: SignupRole) => void;
  onLogin: () => void;
}) {
  return (
    <AuthLayout title="Welcome" subtitle="Create an account to get started.">
      <View style={styles.roleList}>
        {SIGNUP_ROLES.map((role) => {
          const p = PERSONAS[role];
          return (
            <Pressable
              key={role}
              onPress={() => onSignup(role)}
              accessibilityRole="button"
              accessibilityLabel={`Sign up as ${p.label}`}
              style={({ pressed }) => [styles.roleCard, pressed && styles.pressed]}>
              <View style={styles.roleHead}>
                <IconTile icon={p.icon} tone="primary" size={48} />
                <View style={styles.roleText}>
                  <Text style={styles.roleTitle} numberOfLines={1}>
                    {p.label}
                  </Text>
                  <Text style={styles.roleTagline} numberOfLines={1}>
                    {p.tagline}
                  </Text>
                </View>
              </View>
              <View style={styles.signupRow}>
                <Text style={styles.signupText}>Sign up as {p.label}</Text>
                <Ionicons name="arrow-forward" size={18} color={C.primary} />
              </View>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.spacer} />

      <View style={styles.loginBlock}>
        <Text style={styles.loginHint}>Already have an account?</Text>
        <Button label="Log in" variant="dark" icon="log-in-outline" onPress={onLogin} />
      </View>
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.7 },
  roleList: { gap: 12 },
  roleCard: {
    borderRadius: Brand.radius.lg,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    overflow: 'hidden',
    ...Brand.shadow.card,
  },
  roleHead: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16 },
  roleText: { flex: 1, minWidth: 0, gap: 2 },
  roleTitle: { ...Brand.type.heading, color: C.ink },
  roleTagline: { ...Brand.type.caption, color: C.ink3 },
  signupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 13,
    backgroundColor: C.primarySoft,
    borderTopWidth: 1,
    borderTopColor: C.primaryLine,
  },
  signupText: { ...Brand.type.bodyStrong, color: C.primary },
  spacer: { flexGrow: 1, minHeight: 4 },
  loginBlock: { gap: 10 },
  loginHint: { ...Brand.type.caption, color: C.ink3, textAlign: 'center' },
});
