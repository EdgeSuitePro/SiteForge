import 'server-only';

import { and, eq } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { getDb } from '../db/client';
import { workspaceMembers, workspaces, type WorkspaceRole } from '../db/schema';
import { serverEnv } from '../env';
import { devUserIdForEmail } from './dev-identity';
import { SESSION_COOKIE, createSessionToken, verifySessionToken, SESSION_TTL_SECONDS } from './session';

export interface Operator {
  userId: string;
  email: string;
  workspaceId: string;
  workspaceName: string;
  role: WorkspaceRole;
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

const LOCAL_WORKSPACE = { slug: 'local', name: 'EdgeSuite Pro (local)' };

/** Resolve the signed-in operator and their workspace membership, or null. */
export async function getOperator(): Promise<Operator | null> {
  const env = serverEnv();
  if (env.auth.mode !== 'dev') {
    // The Supabase auth adapter is implemented once the dedicated SiteForge Supabase project exists.
    throw new AuthError('Supabase authentication is not wired up yet. Use SITEFORGE_AUTH_MODE=dev locally.', 401);
  }

  const store = await cookies();
  const session = verifySessionToken(store.get(SESSION_COOKIE)?.value, env.sessionSecret);
  if (!session) return null;

  const db = await getDb();
  const [membership] = await db
    .select({
      workspaceId: workspaceMembers.workspaceId,
      role: workspaceMembers.role,
      workspaceName: workspaces.name,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, session.sub))
    .orderBy(workspaces.createdAt)
    .limit(1);
  if (!membership) return null;

  return { userId: session.sub, email: session.email, ...membership };
}

/** For server components / pages: redirect to /login when there is no operator. */
export async function requireOperator(): Promise<Operator> {
  const operator = await getOperator();
  if (!operator) redirect('/login');
  return operator;
}

/** For route handlers: throw an AuthError (mapped to 401) when there is no operator. */
export async function requireApiOperator(): Promise<Operator> {
  const operator = await getOperator();
  if (!operator) throw new AuthError('Please sign in.', 401);
  return operator;
}

/**
 * Dev auth mode: sign in as the configured local operator, provisioning the local workspace
 * and membership on first use. Refuses to run in any other auth mode.
 */
export async function devSignIn(): Promise<void> {
  const env = serverEnv();
  if (env.auth.mode !== 'dev' || env.isDeployed) throw new AuthError('Dev sign-in is disabled.', 403);

  const email = env.auth.devOperatorEmail.toLowerCase();
  const userId = devUserIdForEmail(email);
  const db = await getDb();

  await db.transaction(async (tx) => {
    await tx.insert(workspaces).values(LOCAL_WORKSPACE).onConflictDoNothing({ target: workspaces.slug });
    const [workspace] = await tx.select().from(workspaces).where(eq(workspaces.slug, LOCAL_WORKSPACE.slug));
    if (!workspace) throw new Error('Local workspace could not be created.');
    const [existing] = await tx
      .select({ id: workspaceMembers.id })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspace.id), eq(workspaceMembers.userId, userId)));
    if (!existing) {
      await tx.insert(workspaceMembers).values({ workspaceId: workspace.id, userId, email, role: 'owner' });
    }
  });

  const store = await cookies();
  store.set(SESSION_COOKIE, createSessionToken({ id: userId, email }, env.sessionSecret), {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.nodeEnv === 'production',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function signOut(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
