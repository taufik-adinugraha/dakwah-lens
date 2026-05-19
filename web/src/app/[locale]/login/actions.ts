"use server";

import { AuthError } from "next-auth";
import { eq } from "drizzle-orm";
import { hash } from "bcrypt-ts";
import { z } from "zod";

import { signIn } from "@/auth";
import { db, schema } from "@/db";
import { consumeAuthToken, issueAuthToken } from "@/lib/auth-tokens";
import { appUrl, renderEmail, sendEmail } from "@/lib/email";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

/* ───────────────────────────────────────────────────────────────
 * Rate-limit budgets per auth endpoint.
 *
 * IP-based budgets stop scripted attacks from one source. Email-based
 * budgets stop credential-stuffing across many IPs targeting one
 * account (and prevent password-reset / verification email spam).
 *
 * Trade-off: email-based limiting on signin lets a hostile actor
 * temporarily lock a known account by spraying wrong passwords —
 * accepted at our scale because it's bounded (1 hour window), the
 * owner can still use forgot-password (rate-limited separately), and
 * the alternative is letting distributed brute-force run uncontested.
 *
 * All counters are in-process. Lost on restart, not shared across
 * Node instances. See lib/rate-limit.ts for the upgrade path (Redis).
 * ─────────────────────────────────────────────────────────────── */

const SIGNIN_IP_MAX = 5;
const SIGNIN_IP_WINDOW_MS = 5 * 60_000; // 5 min
const SIGNIN_EMAIL_MAX = 10;
const SIGNIN_EMAIL_WINDOW_MS = 60 * 60_000; // 1 hour

const SIGNUP_IP_MAX = 10;
const SIGNUP_IP_WINDOW_MS = 15 * 60_000;

const FORGOT_IP_MAX = 3;
const FORGOT_IP_WINDOW_MS = 15 * 60_000;
const FORGOT_EMAIL_MAX = 3;
const FORGOT_EMAIL_WINDOW_MS = 60 * 60_000;

const RESET_IP_MAX = 10;
const RESET_IP_WINDOW_MS = 15 * 60_000;

const VERIFY_IP_MAX = 10;
const VERIFY_IP_WINDOW_MS = 15 * 60_000;

// Verification-email resend. Tight caps because each call burns one
// transactional email from the Resend quota — easy to drain the free
// tier with a stuck retry loop or a malicious actor harvesting tokens.
const RESEND_IP_MAX = 5;
const RESEND_IP_WINDOW_MS = 15 * 60_000;
const RESEND_EMAIL_MAX = 3;
const RESEND_EMAIL_WINDOW_MS = 60 * 60_000;

function safeCallbackUrl(raw: string | undefined | null): string {
  const candidate = (raw ?? "/dashboard").toString();
  return candidate.startsWith("/") && !candidate.startsWith("//")
    ? candidate
    : "/dashboard";
}

/**
 * Caps applied to every public-facing auth input. These exist so a
 * malicious POST (curl, scripted bot — HTML maxLength is decorative,
 * not enforcing) can't fill the Postgres `text` column with megabytes
 * of payload or DOS the bcrypt comparator with a giant input.
 *
 *   - email max 254 — RFC 5321 hard limit on real-world email length
 *   - name max 120 — matches the contact form convention
 *   - password max 256 — well above any human password; bcrypt itself
 *     only reads ~72 bytes but the zod gate keeps the request body
 *     bounded before it reaches the comparator
 *   - token max 256 — our reset tokens are short hex strings, this is
 *     a safety net not a tight constraint
 */
const SignupSchema = z.object({
  name: z.string().trim().min(1, "error_name_required").max(120),
  email: z.string().trim().toLowerCase().email("error_invalid_email").max(254),
  password: z.string().min(10, "error_password_short").max(256),
});

const SigninSchema = z.object({
  email: z.string().trim().toLowerCase().email("error_invalid_email").max(254),
  password: z.string().min(1, "error_invalid_credentials").max(256),
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

  // Rate-limit by IP to stop scripted signup spam. No email-side
  // limit here — email is captured first time and we want legitimate
  // typos / re-attempts to go through.
  const ip = await getClientIp();
  if (ip) {
    const rl = checkRateLimit(
      `signup:ip:${ip}`,
      SIGNUP_IP_MAX,
      SIGNUP_IP_WINDOW_MS,
    );
    if (!rl.ok) return { ok: false, error: "error_rate_limited" };
  }

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
    html: renderEmail({
      greeting: "Assalamu'alaykum,",
      heading: "Verifikasi email Anda",
      paragraphs: [
        "Terima kasih sudah mendaftar di <strong>Dakwah-Lens</strong>. Klik tombol di bawah untuk memverifikasi email Anda dan menyelesaikan pendaftaran.",
      ],
      cta: { label: "Verifikasi email", url: link },
      footnote:
        "Tautan ini berlaku 24 jam. Kalau Anda tidak merasa mendaftar, abaikan saja email ini.",
    }),
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

  // Rate-limit BEFORE the DB lookup so a flood can't even probe whether
  // an email exists. IP cap is the broad shield; per-email cap blocks
  // the case where one address is repeatedly hit from rotating IPs.
  const ip = await getClientIp();
  if (ip) {
    const rl = checkRateLimit(
      `resend:ip:${ip}`,
      RESEND_IP_MAX,
      RESEND_IP_WINDOW_MS,
    );
    if (!rl.ok) return { ok: false, error: "error_rate_limited" };
  }
  const rlEmail = checkRateLimit(
    `resend:email:${email}`,
    RESEND_EMAIL_MAX,
    RESEND_EMAIL_WINDOW_MS,
  );
  if (!rlEmail.ok) return { ok: false, error: "error_rate_limited" };

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
  // Rate-limit by IP so an attacker can't brute-force the verify
  // token. Tokens are random + short-lived already, this is defense
  // in depth.
  const ip = await getClientIp();
  if (ip) {
    const rl = checkRateLimit(
      `verify:ip:${ip}`,
      VERIFY_IP_MAX,
      VERIFY_IP_WINDOW_MS,
    );
    if (!rl.ok) return { ok: false, error: "error_rate_limited" };
  }

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
  email: z.string().trim().toLowerCase().email("error_invalid_email").max(254),
});

const ResetSchema = z.object({
  email: z.string().trim().toLowerCase().email("error_invalid_email").max(254),
  token: z.string().min(1, "error_token_missing").max(256),
  password: z.string().min(10, "error_password_short").max(256),
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

  // Rate-limit by IP and email. Stops being used as a free email-spam
  // relay (Resend bill + recipient inbox abuse) and prevents
  // enumeration attempts.
  const ip = await getClientIp();
  if (ip) {
    const rl = checkRateLimit(
      `forgot:ip:${ip}`,
      FORGOT_IP_MAX,
      FORGOT_IP_WINDOW_MS,
    );
    if (!rl.ok) return { ok: false, error: "error_rate_limited" };
  }
  const rlEmail = checkRateLimit(
    `forgot:email:${email}`,
    FORGOT_EMAIL_MAX,
    FORGOT_EMAIL_WINDOW_MS,
  );
  if (!rlEmail.ok) return { ok: false, error: "error_rate_limited" };

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
      html: renderEmail({
        greeting: "Assalamu'alaykum,",
        heading: "Reset password Anda",
        paragraphs: [
          "Kami menerima permintaan untuk mereset password akun <strong>Dakwah-Lens</strong> Anda. Klik tombol di bawah untuk membuat password baru.",
        ],
        cta: { label: "Reset password", url: link },
        footnote:
          "Tautan ini berlaku <strong>1 jam</strong>. Kalau bukan Anda yang meminta, abaikan email ini — password lama tetap aman.",
      }),
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

  // Rate-limit by IP. Tokens are random + single-use + short-lived but
  // we add an outer envelope to stop a flood of token guesses.
  const ip = await getClientIp();
  if (ip) {
    const rl = checkRateLimit(
      `reset:ip:${ip}`,
      RESET_IP_MAX,
      RESET_IP_WINDOW_MS,
    );
    if (!rl.ok) return { ok: false, error: "error_rate_limited" };
  }

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

  // Rate-limit BEFORE invoking signIn so we don't burn a bcrypt
  // comparator cycle on already-blocked attempts. Pattern matches the
  // contact form: increment-on-call. A normal human won't make 5
  // attempts in 5 minutes; legitimate fat-fingered logins still fit.
  const ip = await getClientIp();
  if (ip) {
    const rl = checkRateLimit(
      `signin:ip:${ip}`,
      SIGNIN_IP_MAX,
      SIGNIN_IP_WINDOW_MS,
    );
    if (!rl.ok) return { ok: false, error: "error_rate_limited" };
  }
  const rlEmail = checkRateLimit(
    `signin:email:${parsed.data.email}`,
    SIGNIN_EMAIL_MAX,
    SIGNIN_EMAIL_WINDOW_MS,
  );
  if (!rlEmail.ok) return { ok: false, error: "error_rate_limited" };

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
      // The authorize callback in auth.ts throws CredentialsSignin
      // with a distinct `.code` for each failure mode so the UI can
      // surface a useful message instead of one generic "invalid".
      const code = (error as AuthError & { code?: string }).code;
      if (code === "email_unverified") {
        return { ok: false, error: "error_email_unverified" };
      }
      if (code === "email_not_registered") {
        return { ok: false, error: "error_email_not_registered" };
      }
      if (code === "oauth_only_account") {
        return { ok: false, error: "error_oauth_only_account" };
      }
      // Wrong password (authorize returned null) falls through to here.
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
