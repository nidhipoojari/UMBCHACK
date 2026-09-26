import 'server-only';

import { db } from '@/lib/db';
import type { ApplicantProfile, EmployerProfile, Role, UserRow } from '@/lib/users';
import type { FirebaseClaims } from '@/lib/verify-token';

export type Account = {
  user: UserRow;
  profile: ApplicantProfile | EmployerProfile | null;
};

/**
 * Records a sign-in and returns the account, in one transaction.
 *
 * The users row is upserted from the verified token. A role, once set, is
 * kept: signing in again without one must not wipe it. Then the profile row for
 * that role is created if it does not exist yet, seeded from the account, so
 * both sides have their data in place the first time they land on a dashboard.
 */
export async function recordSignIn(claims: FirebaseClaims, role: Role | null): Promise<Account> {
  const provider = claims.provider === 'google.com' ? 'google' : 'password';
  const email = claims.email.trim().toLowerCase();

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query<UserRow>(
      `INSERT INTO users (user_id, email, name, role, provider)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id) DO UPDATE SET
         email = EXCLUDED.email,
         name  = COALESCE(EXCLUDED.name, users.name),
         role  = COALESCE(users.role, EXCLUDED.role)
       RETURNING *`,
      [claims.uid, email, claims.name ?? null, role, provider],
    );
    const user = rows[0];

    let profile: Account['profile'] = null;
    if (user.role === 'applicant') {
      await client.query(
        `INSERT INTO applicant_profiles (user_id, full_name, email)
         VALUES ($1, $2, $3) ON CONFLICT (user_id) DO NOTHING`,
        [user.user_id, user.name, user.email],
      );
      profile = (
        await client.query<ApplicantProfile>('SELECT * FROM applicant_profiles WHERE user_id = $1', [
          user.user_id,
        ])
      ).rows[0];
    } else if (user.role === 'employer') {
      await client.query(
        `INSERT INTO employer_profiles (user_id, contact_name, contact_email)
         VALUES ($1, $2, $3) ON CONFLICT (user_id) DO NOTHING`,
        [user.user_id, user.name, user.email],
      );
      profile = (
        await client.query<EmployerProfile>('SELECT * FROM employer_profiles WHERE user_id = $1', [
          user.user_id,
        ])
      ).rows[0];
    }

    await client.query('COMMIT');
    return { user, profile };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
