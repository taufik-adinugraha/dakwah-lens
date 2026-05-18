"use server";

import { AuthError } from "next-auth";
import { eq } from "drizzle-orm";
import { hash } from "bcrypt-ts";
import { z } from "zod";

import { signIn } from "@/auth";
import { db, schema } from "@/db";
import { consumeAuthToken, issueAuthToken } from "@/lib/auth-tokens";
import { appUrl, sendEmail } from "@/lib/email";

function safeCallbackUrl(raw: string | undefined | null): string {
  const candidate = (raw ?? "/dashboard").toString();
  return candidate.startsWith("/") && !candidate.startsWith("//")
    ? candidate
    : "/dashboard";
}

const SignupSchema = z.object({
  name: z.string().trim().min(1, "error_name_required"),
  email: z.string().trim().toLowerCase().email("error_invalid_email"),
  password: z.string().min(10, "error_password_short"),
});

const SigninSchema = z.object({
  email: z.string().trim().toLowerCase().email("error_invalid_email"),
  password: z.string().min(1, "error_invalid_credentials"),
});

export type SignupResult =
  | { ok: true; pending: boolean; needsVerification: boolean; email: string }
  | { ok: false; error: string };

/** Errored sign-in returns this. Successful sign-in throws a redirect (handled by Next). */
export type SigninError = { ok: false; error: string };

export async function signupAction(formData: FormData): Promise<SignupResult> {
  const parsed = SignupSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }
  const { name, email, password } = parsed.data;

  const [existing] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);
  if (existing) {
    return { ok: false, error: "error_email_taken" };
  }

  const passwordHash = await hash(password, 10);

  const superEmail = process.env.SUPERADMIN_EMAIL?.toLowerCase();
  const adminEmail = process.env.ADMIN_EMAIL?.toLowerCase();
  const role =
    superEmail && email === superEmail
      ? "superadmin"
      : adminEmail && email === adminEmail
        ? "admin"
        : "user";
  const autoApproved = role !== "user";

  // Always create unverified — even bootstrap admin/superadmin accounts
  // verify their email before they can sign in. emailVerified=NULL until
  // they click the link. /admin/users filters NULLs out so the user list
  // only shows people who actually own their inbox.
  await db.insert(schema.users).values({
    name,
    email,
    passwordHash,
    status: autoApproved ? "approved" : "pending",
    role,
  });

  await sendVerificationEmail(email);

  return {
    ok: true,
    pending: !autoApproved,
    needsVerification: true,
    email,
  };
}

/* ───────────────────────────────────────────────────────────────
 * Email verification
 * ─────────────────────────────────────────────────────────────── */

async function sendVerificationEmail(email: string): Promise<void> {
  const { token } = await issueAuthToken("verify", email);
  const link = appUrl(
    `/auth/verify?email=${encodeURIComponent(email)}&token=${token}`,
  );
  await sendEmail({
    to: email,
    subject: "Verifikasi email · Dakwah-Lens",
    text:
      `Assalamu'alaykum,\n\n` +
      `Klik tautan ini untuk memverifikasi email Anda dan menyelesaikan pendaftaran Dakwah-Lens:\n\n${link}\n\n` +
      `Tautan ini berlaku 24 jam. Kalau Anda tidak merasa mendaftar, abaikan email ini.\n\n` +
      `— Dakwah-Lens · Sukses & Berkah Group`,
    html: `
      <div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:0 auto;color:#0f172a;">
        <p>Assalamu'alaykum,</p>
        <p>Terima kasih sudah mendaftar di <strong>Dakwah-Lens</strong>. Klik tombol di bawah untuk memverifikasi email Anda dan menyelesaikan pendaftaran:</p>
        <p style="margin:24px 0;">
          <a href="${link}" style="display:inline-block;background:#0f172a;color:#fff;padding:12px 20px;border-radius:9999px;text-decoration:none;font-weight:600;">Verifikasi email</a>
        </p>
        <p style="font-size:12px;color:#64748b;">Atau salin tautan ini: <br><span style="word-break:break-all;">${link}</span></p>
        <p style="font-size:12px;color:#64748b;">Tautan ini berlaku 24 jam. Kalau Anda tidak merasa mendaftar, abaikan email ini.</p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
        <p style="font-size:12px;color:#94a3b8;">Dakwah-Lens · Sukses & Berkah Group</p>
      </div>
    `,
  });
}

export type ResendVerificationResult =
  | { ok: true }
  | { ok: false; error: string };

/** Re-send the verification email. Idempotent — issuing a new token wipes
 *  the previous one. Always returns ok=true for non-existent emails to
 *  avoid leaking which addresses are registered. */
export async function resendVerificationAction(
  formData: FormData,
): Promise<ResendVerificationResult> {
  const raw = formData.get("email");
  const email =
    typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "error_invalid_email" };
  }
  const [user] = await db
    .select({ id: schema.users.id, verified: schema.users.emailVerified })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);
  // Already verified → quietly succeed; don't tell them yes-or-no.
  if (!user || user.verified) {
    return { ok: true };
  }
  await sendVerificationEmail(email);
  return { ok: true };
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; error: string };

/** Consume a `?token=&email=` pair. Called from the /auth/verify route
 *  handler so the click-through is a real navigation that lands on the
 *  login page with a success banner. */
export async function verifyEmailAction(
  email: string,
  token: string,
): Promise<VerifyResult> {
  const consumed = await consumeAuthToken("verify", email, token);
  if (!consumed) return { ok: false, error: "error_verify_invalid" };
  await db
    .update(schema.users)
    .set({ emailVerified: new Date(), updatedAt: new Date() })
    .where(eq(schema.users.email, consumed));
  return { ok: true };
}

/* ───────────────────────────────────────────────────────────────
 * Forgot / reset password
 * ─────────────────────────────────────────────────────────────── */

const ForgotSchema = z.object({
  email: z.string().trim().toLowerCase().email("error_invalid_email"),
});

const ResetSchema = z.object({
  email: z.string().trim().toLowerCase().email("error_invalid_email"),
  token: z.string().min(1, "error_token_missing"),
  password: z.string().min(10, "error_password_short"),
});

export type ForgotResult =
  | { ok: true }
  | { ok: false; error: string };

/** Generate a reset token + send the email. Always returns ok=true to avoid
 *  email enumeration (revealing which addresses have accounts). */
export async function forgotPasswordAction(
  formData: FormData,
): Promise<ForgotResult> {
  const parsed = ForgotSchema.safeParse({
    email: formData.get("email"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }
  const { email } = parsed.data;

  const [user] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);

  // Silently no-op for unknown emails — user-facing flow shows the same
  // confirmation either way.
  if (user) {
    const { token } = await issueAuthToken("reset", email);
    const link = appUrl(
      `/login/reset?email=${encodeURIComponent(email)}&token=${token}`,
    );
    await sendEmail({
      to: email,
      subject: "Reset password · Dakwah-Lens",
      text:
        `Assalamu'alaykum,\n\n` +
        `Kami menerima permintaan untuk mereset password akun Dakwah-Lens Anda. Klik tautan ini untuk membuat password baru:\n\n${link}\n\n` +
        `Tautan ini berlaku 1 jam. Kalau bukan Anda yang meminta, abaikan email ini — password lama tetap aman.\n\n` +
        `— Dakwah-Lens · Sukses & Berkah Group`,
      html: `
        <div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:0 auto;color:#0f172a;">
          <p>Assalamu'alaykum,</p>
          <p>Kami menerima permintaan untuk mereset password akun <strong>Dakwah-Lens</strong> Anda. Klik tombol di bawah untuk membuat password baru:</p>
          <p style="margin:24px 0;">
            <a href="${link}" style="display:inline-block;background:#0f172a;color:#fff;padding:12px 20px;border-radius:9999px;text-decoration:none;font-weight:600;">Reset password</a>
          </p>
          <p style="font-size:12px;color:#64748b;">Atau salin tautan ini: <br><span style="word-break:break-all;">${link}</span></p>
          <p style="font-size:12px;color:#64748b;">Tautan ini berlaku <strong>1 jam</strong>. Kalau bukan Anda yang meminta, abaikan email ini — password lama tetap aman.</p>
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
          <p style="font-size:12px;color:#94a3b8;">Dakwah-Lens · Sukses & Berkah Group</p>
        </div>
      `,
    });
  }

  return { ok: true };
}

export type ResetResult =
  | { ok: true }
  | { ok: false; error: string };

/** Validate the token and write a new bcrypt hash. */
export async function resetPasswordAction(
  formData: FormData,
): Promise<ResetResult> {
  const parsed = ResetSchema.safeParse({
    email: formData.get("email"),
    token: formData.get("token"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }
  const { email, token, password } = parsed.data;
  const consumed = await consumeAuthToken("reset", email, token);
  if (!consumed) return { ok: false, error: "error_reset_invalid" };

  const passwordHash = await hash(password, 10);
  await db
    .update(schema.users)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(schema.users.email, consumed));
  return { ok: true };
}

/**
 * Canonical Auth.js v5 credentials sign-in pattern.
 *
 * `signIn` with `redirectTo` will:
 *   1. Validate credentials (calls `authorize` in auth.ts)
 *   2. Sign a JWT and write the session cookie
 *   3. Throw a `NEXT_REDIRECT` error which Next.js converts to a 302 response
 *      that INCLUDES the Set-Cookie header
 *
 * If we instead used `redirect: false`, signIn would NOT reliably set the
 * cookie before returning — the result is "successful" auth that doesn't
 * stick. That's the previous bug.
 */
export async function signinAction(
  formData: FormData,
): Promise<SigninError | undefined> {
  const parsed = SigninSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  // Only accept relative callback URLs to avoid open redirects.
  // Default landing for a successful sign-in is the Dashboard.
  const raw = formData.get("callbackUrl")?.toString() ?? "/dashboard";
  const callbackUrl =
    raw.startsWith("/") && !raw.startsWith("//") ? raw : "/dashboard";

  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: callbackUrl,
    });
    // Unreachable on success — signIn throws the redirect.
  } catch (error) {
    if (error instanceof AuthError) {
      // The `authorize` callback throws `CredentialsSignin("email_unverified")`
      // when the password matches but emailVerified is NULL. Auth.js exposes
      // that on `.code`.
      const code = (error as AuthError & { code?: string }).code;
      if (code === "email_unverified") {
        return { ok: false, error: "error_email_unverified" };
      }
      return { ok: false, error: "error_invalid_credentials" };
    }
    // NEXT_REDIRECT and similar framework errors must propagate.
    throw error;
  }
}

/**
 * Server Action that kicks off the Google OAuth flow.
 *
 * Auth.js v5 dropped GET support for `/api/auth/signin/<provider>` — we
 * have to invoke `signIn()` server-side. Like the credentials sign-in, the
 * call throws a NEXT_REDIRECT that Next.js converts into a redirect to
 * Google's consent screen, with cookies properly written along the way.
 */
export async function googleSignInAction(formData: FormData): Promise<void> {
  const callbackUrl = safeCallbackUrl(formData.get("callbackUrl")?.toString());
  await signIn("google", { redirectTo: callbackUrl });
  // Unreachable on success — signIn throws the redirect.
}
