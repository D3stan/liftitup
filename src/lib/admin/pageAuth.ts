import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import type { UserProfile } from '@/types/domain';
import { hashToken, SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { getAuthSessionByTokenHash } from '@/lib/db/sessions';
import { getUserById } from '@/lib/db/users';
import { isAdminUser } from './auth';

/**
 * Server-component page guard for `/admin` and `/admin/**`.
 * Reads only the `liftitup_session` cookie (never API keys) and calls
 * Next.js `notFound()` (HTTP 404) for anyone who is not a non-guest,
 * non-disabled user listed in `ADMIN_USER_IDS`.
 */
export async function requireAdminPage(): Promise<UserProfile> {
  const cookieStore = await cookies();
  const rawToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!rawToken) {
    notFound();
  }

  const tokenHash = hashToken(rawToken);
  const session = await getAuthSessionByTokenHash(tokenHash);
  if (!session || Date.parse(session.expiresAt) <= Date.now()) {
    notFound();
  }

  const user = await getUserById(session.userId);
  if (!user || !isAdminUser(user)) {
    notFound();
  }

  return user;
}
