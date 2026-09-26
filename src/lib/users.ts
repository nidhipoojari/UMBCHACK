export type Role = 'applicant' | 'employer';

export type UserRow = {
  user_id: string;
  email: string;
  name: string | null;
  role: Role | null;
  provider: 'password' | 'google';
  created_at: string;
};
