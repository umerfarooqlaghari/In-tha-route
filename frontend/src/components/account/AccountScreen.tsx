"use client";

import { AlertTriangle, Check, ImagePlus, KeyRound, Trash2, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { Button, Card, Modal } from "@/components/ui";
import { Field } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { ApiError, api, endDeleted, errorMessage, logoSrc, saveSession, updateSessionUser, type Portal } from "@/lib/api";
import { useAdmin } from "@/lib/admin-store";
import { initials } from "@/lib/format";
import { useMerchant } from "@/lib/merchant-store";
import type { AuthSession, AuthUser } from "@/lib/types";

type Errors = Record<string, string>;
const fieldsOf = (err: unknown): Errors => (err instanceof ApiError ? err.fields : {});

const LOGO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const LOGO_MAX_BYTES = 2 * 1024 * 1024;

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <p className="text-[12px] font-bold tracking-[0.14em] text-ink-3 uppercase">{children}</p>;
}

/** Your own account (merchant or admin): name, email, password, and deleting it. */
export function AccountScreen({ portal, user, onChanged }: { portal: Portal; user: AuthUser; onChanged?: () => void }) {
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <div className="space-y-6">
        {user.restaurant && <BusinessCard portal={portal} user={user} onChanged={onChanged} />}
        <DetailsCard portal={portal} user={user} />
      </div>
      <div className="space-y-6">
        <PasswordCard portal={portal} />
        <DeleteCard portal={portal} role={user.role} />
      </div>
    </div>
  );
}

function BusinessCard({ portal, user, onChanged }: { portal: Portal; user: AuthUser; onChanged?: () => void }) {
  const toast = useToast();
  const restaurant = user.restaurant!;
  const [name, setName] = useState(restaurant.name);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const done = (next: AuthUser) => {
    updateSessionUser(portal, next);
    onChanged?.();
  };

  const saveName = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(undefined);
    try {
      done((await api<{ user: AuthUser }>(portal, "PATCH", "/api/restaurant/profile", { name })).user);
      toast({ tone: "success", title: "Merchant name saved" });
    } catch (err) {
      const f = fieldsOf(err);
      if (f.name) setError(f.name);
      else toast({ tone: "error", title: "Couldn’t save", body: errorMessage(err) });
    } finally {
      setSaving(false);
    }
  };

  const upload = async (file: File) => {
    if (!LOGO_TYPES.includes(file.type)) {
      toast({ tone: "error", title: "Logo not supported", body: "Please use a JPEG, PNG or WebP image." });
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      toast({ tone: "error", title: "Logo too large", body: "Please use an image under 2 MB." });
      return;
    }
    setLogoBusy(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(r.error);
        r.readAsDataURL(file);
      });
      const imageBase64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
      done((await api<{ user: AuthUser }>(portal, "PUT", "/api/restaurant/logo", { imageBase64, mimeType: file.type })).user);
      toast({ tone: "success", title: "Logo updated" });
    } catch (err) {
      toast({ tone: "error", title: "Couldn’t upload the logo", body: errorMessage(err) });
    } finally {
      setLogoBusy(false);
    }
  };

  const removeLogo = async () => {
    setLogoBusy(true);
    try {
      done((await api<{ user: AuthUser }>(portal, "DELETE", "/api/restaurant/logo")).user);
      toast({ tone: "success", title: "Logo removed" });
    } catch (err) {
      toast({ tone: "error", title: "Couldn’t remove the logo", body: errorMessage(err) });
    } finally {
      setLogoBusy(false);
    }
  };

  const logo = logoSrc(restaurant.logoUrl);
  const trimmed = name.trim();
  return (
    <Card className="p-6">
      <SectionTitle>Business</SectionTitle>
      <div className="mt-4 flex flex-wrap items-center gap-4">
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element -- served by the API, not a static asset
          <img src={logo} alt="Your logo" className="size-20 shrink-0 rounded-full bg-surface-alt object-cover ring-1 ring-line" />
        ) : (
          <span className="brand-gradient grid size-20 shrink-0 place-items-center rounded-full text-xl font-extrabold text-white">
            {initials(restaurant.name) || "M"}
          </span>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" loading={logoBusy} icon={<ImagePlus className="size-4" />} onClick={() => fileRef.current?.click()}>
            {logo ? "Change logo" : "Add logo"}
          </Button>
          {logo && !logoBusy && (
            <Button variant="ghost" size="sm" icon={<Trash2 className="size-4" />} onClick={removeLogo}>
              Remove
            </Button>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept={LOGO_TYPES.join(",")}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) upload(f);
          }}
        />
      </div>
      <p className="mt-3 text-sm text-ink-3">A square JPEG or PNG under 2 MB works best. It shows at the top of your dashboard and app.</p>
      <form onSubmit={saveName} className="mt-5 space-y-4">
        <Field label="Merchant name" value={name} onChange={(e) => setName(e.target.value)} error={error} autoComplete="organization" />
        <Button type="submit" loading={saving} disabled={trimmed.length < 2 || trimmed === restaurant.name} icon={<Check className="size-4" />}>
          Save name
        </Button>
      </form>
    </Card>
  );
}

function DetailsCard({ portal, user }: { portal: Portal; user: AuthUser }) {
  const toast = useToast();
  const [fullName, setFullName] = useState(user.fullName);
  const [email, setEmail] = useState(user.email);
  const [currentPassword, setCurrentPassword] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);

  const cleanEmail = email.trim().toLowerCase();
  const emailChanged = cleanEmail !== user.email;
  const nameChanged = fullName.trim() !== user.fullName;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    try {
      const body = {
        ...(nameChanged && { fullName: fullName.trim() }),
        ...(emailChanged && { email: cleanEmail, currentPassword }),
      };
      const next = (await api<{ user: AuthUser }>(portal, "PATCH", "/api/auth/account", body)).user;
      updateSessionUser(portal, next);
      setEmail(next.email);
      setFullName(next.fullName);
      setCurrentPassword("");
      toast({
        tone: "success",
        title: "Details saved",
        body: emailChanged ? `From now on, sign in with ${next.email}.` : undefined,
      });
    } catch (err) {
      if (err instanceof ApiError && err.code === "EMAIL_TAKEN") setErrors({ email: err.message });
      else if (Object.keys(fieldsOf(err)).length) setErrors(fieldsOf(err));
      else toast({ tone: "error", title: "Couldn’t save", body: errorMessage(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-6">
      <SectionTitle>Your details</SectionTitle>
      <form onSubmit={save} className="mt-4 space-y-4">
        <Field
          label="Your name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          error={errors.fullName}
          autoComplete="name"
          icon={<UserRound className="size-4" />}
        />
        <Field
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
          autoComplete="email"
        />
        {emailChanged && (
          <Field
            label="Current password"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            error={errors.currentPassword}
            hint="Needed to change your email."
            autoComplete="current-password"
          />
        )}
        <Button
          type="submit"
          loading={saving}
          disabled={(!nameChanged && !emailChanged) || fullName.trim().length < 2 || (emailChanged && !currentPassword)}
          icon={<Check className="size-4" />}
        >
          Save changes
        </Button>
      </form>
    </Card>
  );
}

function PasswordCard({ portal }: { portal: Portal }) {
  const toast = useToast();
  const [currentPassword, setCurrent] = useState("");
  const [newPassword, setNew] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8 || !/[A-Z]/.test(newPassword) || !/\d/.test(newPassword)) {
      setErrors({ newPassword: "Use at least 8 characters with a capital letter and a number." });
      return;
    }
    setSaving(true);
    setErrors({});
    try {
      // The server signs out other devices and gives this browser a fresh session.
      saveSession(portal, await api<AuthSession>(portal, "PUT", "/api/auth/account/password", { currentPassword, newPassword }));
      setCurrent("");
      setNew("");
      setConfirm("");
      toast({ tone: "success", title: "Password changed", body: "You stay signed in here. Other devices need the new password." });
    } catch (err) {
      if (Object.keys(fieldsOf(err)).length) setErrors(fieldsOf(err));
      else toast({ tone: "error", title: "Couldn’t change the password", body: errorMessage(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-6">
      <SectionTitle>Password</SectionTitle>
      <form onSubmit={save} className="mt-4 space-y-4">
        <Field
          label="Current password"
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrent(e.target.value)}
          error={errors.currentPassword}
          autoComplete="current-password"
          icon={<KeyRound className="size-4" />}
        />
        <Field
          label="New password"
          type="password"
          value={newPassword}
          onChange={(e) => setNew(e.target.value)}
          error={errors.newPassword}
          hint="At least 8 characters, with a capital letter and a number."
          autoComplete="new-password"
        />
        <Field
          label="Confirm new password"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={confirm && confirm !== newPassword ? "Passwords do not match." : undefined}
          autoComplete="new-password"
        />
        <Button type="submit" loading={saving} disabled={!currentPassword || !newPassword || confirm !== newPassword}>
          Change password
        </Button>
      </form>
    </Card>
  );
}

function DeleteCard({ portal, role }: { portal: Portal; role: AuthUser["role"] }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [deleting, setDeleting] = useState(false);

  const what =
    role === "restaurant"
      ? "Your login, name, email, phone and logo are removed. Past orders and credit purchases stay in the records as “Deleted merchant”. Your own drivers can no longer sign in, and unused credits are lost."
      : "Your admin login, name and email are removed. Another admin keeps running the platform.";

  const remove = async (e: React.FormEvent) => {
    e.preventDefault();
    setDeleting(true);
    setError(undefined);
    try {
      await api(portal, "DELETE", "/api/auth/account", { password });
      endDeleted(portal);
      router.replace(portal === "admin" ? "/admin/login" : "/merchant/login");
    } catch (err) {
      const f = fieldsOf(err);
      if (f.password) setError(f.password);
      else {
        setOpen(false);
        toast({ tone: "error", title: "Couldn’t delete the account", body: errorMessage(err) });
      }
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Card className="p-6">
      <SectionTitle>Delete account</SectionTitle>
      <div className="mt-4 flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-brand" />
        <div>
          <p className="font-bold text-ink">This closes your account for good. It can’t be undone.</p>
          <p className="mt-1 text-sm text-ink-3">{what}</p>
        </div>
      </div>
      <Button
        variant="danger"
        className="mt-5"
        icon={<Trash2 className="size-4" />}
        onClick={() => {
          setPassword("");
          setError(undefined);
          setOpen(true);
        }}
      >
        Delete my account
      </Button>
      <Modal open={open} onClose={() => !deleting && setOpen(false)} title="Delete your account?" subtitle="This can’t be undone.">
        <form onSubmit={remove} className="space-y-4">
          <Field
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={error}
            hint="Enter your password to confirm."
            autoComplete="current-password"
            autoFocus
          />
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={deleting}>
              Keep my account
            </Button>
            <Button type="submit" variant="primary" loading={deleting} disabled={!password} icon={<Trash2 className="size-4" />}>
              Delete for good
            </Button>
          </div>
        </form>
      </Modal>
    </Card>
  );
}

/** /merchant/account */
export function MerchantAccountScreen() {
  const { user, refresh } = useMerchant();
  // Keyed by the saved details so the forms start from them again after a save.
  return (
    <AccountScreen key={`${user.email}|${user.fullName}|${user.restaurant?.name}`} portal="merchant" user={user} onChanged={refresh} />
  );
}

/** /admin/account */
export function AdminAccountScreen() {
  const { user } = useAdmin();
  if (!user) return null;
  return <AccountScreen key={`${user.email}|${user.fullName}`} portal="admin" user={user} />;
}
