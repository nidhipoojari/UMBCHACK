'use client';

import { useEffect, useState } from 'react';

import { firebaseAuth } from '@/lib/firebase';
import type { MatchesResponse } from '@/lib/matches';

const POLL_MS = 3000;

/**
 * The applicant's job matches. Polls while match-jobs is still running, so a
 * dashboard opened straight after onboarding fills in by itself, and reloads
 * when the gap interview re-scores them.
 */
export function useMatches(): { data: MatchesResponse | null; error: string | null } {
  const [data, setData] = useState<MatchesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    async function load() {
      try {
        const user = firebaseAuth.currentUser;
        if (!user) return;
        const response = await fetch('/api/matches', {
          headers: { Authorization: `Bearer ${await user.getIdToken()}` },
          cache: 'no-store',
        });
        if (!response.ok) throw new Error(String(response.status));
        const next = (await response.json()) as MatchesResponse;
        if (cancelled) return;
        setData(next);
        setError(null);
        if (next.status === 'pending') timer = window.setTimeout(load, POLL_MS);
      } catch {
        if (!cancelled) setError('Could not load your matches. Try refreshing.');
      }
    }

    load();
    // The gap interview re-scores the matches in place; reload when it says so.
    const reload = () => {
      window.clearTimeout(timer);
      void load();
    };
    window.addEventListener('agenthire:matches-changed', reload);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.removeEventListener('agenthire:matches-changed', reload);
    };
  }, []);

  return { data, error };
}
