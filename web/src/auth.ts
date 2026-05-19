import NextAuth, { CredentialsSignin, type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { compare } from "bcrypt-ts";
import { eq } from "drizzle-orm";

import { db, schema } from "@/db";

/* ─────────────────────────────────────────────────────────────
 * Module augmentation — surface our custom fields to user code.
 * ───────────────────────────────────────────────────────────── */
declare module "next-auth" {
  interface User {
    status?: string;
    role?: string;
    onboarded?: boolean;
  }
  interface Session {
    user: {
      id: string;
      status: string;
      role: string;
      /** True once `users.onboarded_at` is set (or skipped). */
      onboarded: boolean;
    } & DefaultSession["user"];
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    sub: string;
    status: string;
    role: string;
    onboarded: boolean;
  }
}

// Only register Google when both credentials are set. Auth.js v5 throws a
// "Configuration" error if any provider is initialized with empty client
// id/secret — which would block ALL sign-in (including credentials).
const googleConfigured =
  !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: schema.users,
    accountsTable: schema.accounts,
    verificationTokensTable: schema.verificationTokens,
  }),
  session: { strategy: "jwt" },
  trustHost: true,
  pages: {
    signIn: "/login",
  },
  providers: [
    ...(googleConfigured
      ? [
          Google({
            clientId: process.env.GOOGLE_CLIENT_ID!,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
            // Off by design: with this on, anyone who can create a Google
            // account claiming an existing password-account's email could
            // sign in as that user. A returning password user who tries
            // Google instead will hit OAuthAccountNotLinked — they should
            // sign in with their password first, then link Google from a
            // future account-settings flow.
            allowDangerousEmailAccountLinking: false,
          }),
        ]
      : []),
    Credentials({
      name: "Email & password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email;
        const password = credentials?.password;
        if (typeof email !== "string" || typeof password !== "string") {
          return null;
        }

        const [user] = await db
          .select()
          .from(schema.users)
          .where(eq(schema.users.email, email.toLowerCase()))
          .limit(1);

        // Differentiate "no account" vs "wrong password" so the UI can
        // nudge the user to sign up instead of guessing passwords. The
        // security tradeoff (account enumeration) is mitigated by the
        // rate limit on signinAction (5 per IP per 5 min).
        if (!user) {
          throw new CredentialsSignin("email_not_registered");
        }
        // Existing user but no passwordHash → they signed up via Google
        // and never set a password. Send them to the Google button.
        if (!user.passwordHash) {
          throw new CredentialsSignin("oauth_only_account");
        }

        const ok = await compare(password, user.passwordHash);
        if (!ok) return null;

        // Email-verification gate. Credentials accounts must verify their
        // email before they can sign in; OAuth providers (Google) handle
        // this themselves and arrive with `emailVerified` already set.
        if (!user.emailVerified) {
          // CredentialsSignin error surfaces as "invalid credentials" in
          // the UI; the login form separately reads `?unverified=…` to
          // render a more accurate "check your email" message when the
          // signinAction reroutes there.
          throw new CredentialsSignin("email_unverified");
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name ?? undefined,
          image: user.image ?? undefined,
          status: user.status,
          role: user.role,
        };
      },
    }),
  ],
  events: {
    // Fires AFTER the adapter has inserted a new user row — so the
    // UPDATE below actually matches a row (the previous attempt did
    // the bootstrap in `signIn`, which runs *before* the adapter
    // creates the row, and silently updated zero rows on first
    // sign-up).
    async createUser({ user }) {
      if (!user.email) return;
      const email = user.email.toLowerCase();
      const superEmail = process.env.SUPERADMIN_EMAIL?.toLowerCase();
      const adminEmail = process.env.ADMIN_EMAIL?.toLowerCase();
      const targetRole =
        superEmail && email === superEmail
          ? "superadmin"
          : adminEmail && email === adminEmail
            ? "admin"
            : null;
      if (!targetRole) return;
      await db
        .update(schema.users)
        .set({ status: "approved", role: targetRole })
        .where(eq(schema.users.email, email));
    },
  },
  callbacks: {
    async jwt({ token, user }) {
      // First sign-in: seed the JWT from the User row so the DB-refresh
      // step below has sensible defaults if it somehow can't find the row.
      if (user) {
        token.sub = user.id ?? token.sub;
        token.status = (user.status as string) ?? "pending";
        token.role = (user.role as string) ?? "user";
        token.onboarded = false;
      }
      // Always re-fetch status/role/onboarded from the DB. JWTs are signed
      // and cached for the cookie lifetime, so without this an admin
      // approval, role change, or block wouldn't reach the user until they
      // sign out and back in. One query per JWT callback is acceptable at
      // our scale; if it becomes hot, add a Redis-backed cache here.
      if (token.sub) {
        const [fresh] = await db
          .select({
            status: schema.users.status,
            role: schema.users.role,
            onboardedAt: schema.users.onboardedAt,
          })
          .from(schema.users)
          .where(eq(schema.users.id, token.sub))
          .limit(1);
        if (fresh) {
          token.status = fresh.status;
          token.role = fresh.role;
          token.onboarded = !!fresh.onboardedAt;
        }
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.sub;
      session.user.status = token.status;
      session.user.role = token.role;
      session.user.onboarded = token.onboarded;
      return session;
    },
  },
});
