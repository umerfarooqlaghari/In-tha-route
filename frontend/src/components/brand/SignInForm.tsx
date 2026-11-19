"use client";

import { ArrowRight, Lock, Mail } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui";
import { Field } from "@/components/ui/field";
import { ApiError, DISABLED_MESSAGE, errorMessage, getSession, loginRequest, request, saveSession, takeNotice, type Portal } from "@/lib/api";
import type { UserRole } from "@/lib/types";
import { FormError } from "./AuthShell";

const WRONG_ROLE: Record<Portal, string> = {
  admin: "This account isn’t an administrator. Merchants sign in from the Merchant option on the start page.",
  merchant: "This isn’t a merchant account. Administrators sign in from the Administrator option on the start page.",
};

/** Email + password sign-in for one portal. The role always comes from the server. */
export function SignInForm({
  portal,
  role,
  redirectTo,
  footer,
}: {
  portal: Portal;
  role: UserRole;
  redirectTo: string;
  footer?: React.ReactNode;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Already signed in on this browser: go straight in. Otherwise say why the last session ended, if it was ended for us.
  useEffect(() => {
    if (getSession(portal)?.user.role === role) router.replace(redirectTo);
    else {
      const notice = takeNotice(portal);
      // Read from this tab's storage, which the server render can't see.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (notice) setFormError(notice);
    }
  }, [portal, role, redirectTo, router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!email.trim()) next.email = "Email is required.";
    if (!password) next.password = "Password is required.";
    setErrors(next);
    setFormError(null);
    if (Object.keys(next).length) return;

    setLoading(true);
    try {
      const session = await loginRequest(email.trim(), password);
      if (session.user.role !== role) {
        // Don't keep a session for the wrong portal.
        request("POST", "/api/auth/logout", { refreshToken: session.tokens.refreshToken }).catch(() => {});
        setFormError(WRONG_ROLE[portal]);
        setLoading(false);
        return;
      }
      saveSession(portal, session);
      router.replace(redirectTo);
    } catch (err) {
      if (err instanceof ApiError && err.code === "ACCOUNT_DISABLED") setFormError(DISABLED_MESSAGE);
      else if (err instanceof ApiError && Object.keys(err.fields).length) setErrors(err.fields);
      else setFormError(errorMessage(err));
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <FormError message={formError} />
      <Field
        label="Email"
        type="email"
        autoComplete="email"
        placeholder="you@company.com"
        icon={<Mail className="size-4" />}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={errors.email}
        autoFocus
      />
      <Field
        label="Password"
        type="password"
        autoComplete="current-password"
        placeholder="Your password"
        icon={<Lock className="size-4" />}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        error={errors.password}
      />
      <Button
        type="submit"
        size="lg"
        variant={portal === "admin" ? "dark" : "primary"}
        className="group w-full"
        loading={loading}
      >
        {loading ? "Signing in…" : "Sign in"}
        {!loading && <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />}
      </Button>
      {loading && (
        <p className="text-center text-xs text-ink-3">The server may take a moment to wake up on the first sign-in.</p>
      )}
      {footer}
    </form>
  );
}
