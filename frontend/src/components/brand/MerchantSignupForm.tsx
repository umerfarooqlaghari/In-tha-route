"use client";

import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, ArrowRight, Lock, Mail, MapPin, Phone, Store, User } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui";
import { Field } from "@/components/ui/field";
import { ApiError, errorMessage, saveSession, signupRequest } from "@/lib/api";
import { FormError } from "./AuthShell";

/** Fields that belong to each step, so a server error sends the user back to the right one. */
const STEP_FIELDS = [
  ["fullName", "email", "phone", "password", "confirmPassword"],
  ["restaurantName", "address", "postcode", "pickupSafetyNote"],
];

/** Same fields and rules as the app's merchant sign-up, in two short steps. */
export function MerchantSignupForm() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [v, setV] = useState({
    fullName: "",
    email: "",
    phone: "",
    password: "",
    confirmPassword: "",
    restaurantName: "",
    address: "",
    postcode: "",
    pickupSafetyNote: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setV((s) => ({ ...s, [k]: e.target.value }));
    if (errors[k])
      setErrors((prev) => {
        const next = { ...prev };
        delete next[k];
        return next;
      });
  };

  const validate = (s: number) => {
    const e: Record<string, string> = {};
    const need = (k: keyof typeof v, label: string) => {
      if (!v[k].trim()) e[k] = `${label} is required.`;
    };
    if (s === 0) {
      need("fullName", "Full name");
      need("email", "Email");
      need("phone", "Phone");
      if (!v.password) e.password = "Password is required.";
      else if (v.password.length < 8 || !/[A-Za-z]/.test(v.password) || !/\d/.test(v.password))
        e.password = "Use at least 8 characters with a letter and a number.";
      if (!v.confirmPassword) e.confirmPassword = "Please confirm your password.";
      else if (v.password && v.confirmPassword !== v.password) e.confirmPassword = "Passwords do not match.";
    } else {
      need("restaurantName", "Merchant name");
      need("address", "Address");
      need("postcode", "Postcode");
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const next = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (validate(0)) setStep(1);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!validate(1)) return;
    setLoading(true);
    try {
      const session = await signupRequest({
        role: "restaurant",
        email: v.email.trim(),
        password: v.password,
        fullName: v.fullName.trim(),
        phone: v.phone.trim(),
        restaurantName: v.restaurantName.trim(),
        address: v.address.trim(),
        postcode: v.postcode.trim().toUpperCase(),
        ...(v.pickupSafetyNote.trim() && { pickupSafetyNote: v.pickupSafetyNote.trim() }),
      });
      saveSession("merchant", session);
      router.replace("/merchant");
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) {
        setErrors(err.fields);
        if (Object.keys(err.fields).some((f) => STEP_FIELDS[0].includes(f))) setStep(0);
      } else setFormError(errorMessage(err));
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="mb-8">
        <span className="inline-flex items-center gap-2 rounded-full bg-brand px-3 py-1 text-[11px] font-bold tracking-[0.18em] text-white uppercase">
          <Store className="size-3.5" /> New merchant
        </span>
        <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-ink">Create your account</h2>
        <p className="mt-2 text-[15px] text-ink-3">Two quick steps and you’re ready to send orders.</p>

        <div className="mt-6 flex items-center gap-3">
          {["Your details", "Your business"].map((label, i) => (
            <div key={label} className="flex flex-1 items-center gap-3">
              <div className="flex-1">
                <div className="h-1.5 overflow-hidden rounded-full bg-surface-alt">
                  <motion.div
                    className="h-full rounded-full bg-brand"
                    initial={false}
                    animate={{ width: step >= i ? "100%" : "0%" }}
                    transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                  />
                </div>
                <p className={`mt-2 text-xs font-semibold ${step >= i ? "text-ink" : "text-ink-3"}`}>
                  {i + 1}. {label}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <FormError message={formError} />

      <AnimatePresence mode="wait" initial={false}>
        {step === 0 ? (
          <motion.form
            key="s0"
            onSubmit={next}
            noValidate
            initial={{ opacity: 0, x: -30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -30 }}
            transition={{ duration: 0.3 }}
            className="mt-5 space-y-4"
          >
            <Field label="Full name" icon={<User className="size-4" />} autoComplete="name" value={v.fullName} onChange={set("fullName")} error={errors.fullName} autoFocus />
            <Field label="Email" type="email" icon={<Mail className="size-4" />} autoComplete="email" value={v.email} onChange={set("email")} error={errors.email} />
            <Field label="Phone" type="tel" icon={<Phone className="size-4" />} autoComplete="tel" placeholder="07…" value={v.phone} onChange={set("phone")} error={errors.phone} />
            <Field
              label="Password"
              type="password"
              icon={<Lock className="size-4" />}
              autoComplete="new-password"
              value={v.password}
              onChange={set("password")}
              error={errors.password}
              hint="At least 8 characters, with a letter and a number."
            />
            <Field
              label="Confirm password"
              type="password"
              icon={<Lock className="size-4" />}
              autoComplete="new-password"
              value={v.confirmPassword}
              onChange={set("confirmPassword")}
              error={errors.confirmPassword}
              success={v.password && v.confirmPassword === v.password ? "Passwords match" : undefined}
            />
            <Button type="submit" size="lg" className="group w-full">
              Continue <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
            </Button>
          </motion.form>
        ) : (
          <motion.form
            key="s1"
            onSubmit={submit}
            noValidate
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 30 }}
            transition={{ duration: 0.3 }}
            className="mt-5 space-y-4"
          >
            <Field label="Merchant name" icon={<Store className="size-4" />} autoComplete="organization" value={v.restaurantName} onChange={set("restaurantName")} error={errors.restaurantName} autoFocus />
            <Field label="Address" icon={<MapPin className="size-4" />} autoComplete="street-address" value={v.address} onChange={set("address")} error={errors.address} />
            <Field label="Postcode" placeholder="TW9 1DT" autoComplete="postal-code" value={v.postcode} onChange={set("postcode")} error={errors.postcode} />
            <Field
              label="Pickup note (optional)"
              placeholder="e.g. Collect from the side door"
              value={v.pickupSafetyNote}
              onChange={set("pickupSafetyNote")}
              error={errors.pickupSafetyNote}
            />
            <div className="flex gap-3">
              <Button type="button" variant="secondary" size="lg" onClick={() => setStep(0)} disabled={loading} icon={<ArrowLeft className="size-4" />}>
                Back
              </Button>
              <Button type="submit" size="lg" className="flex-1" loading={loading}>
                {loading ? "Creating account…" : "Create account"}
              </Button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>

      <p className="mt-6 text-center text-sm text-ink-2">
        Already have an account?{" "}
        <Link href="/merchant/login" className="font-bold text-brand underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
