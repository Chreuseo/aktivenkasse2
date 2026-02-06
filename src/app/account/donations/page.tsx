'use client';

import React, { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { extractToken, fetchJson } from '@/lib/utils';
import { DonationRow } from '@/app/types/donation';
import DonationsTable from '@/app/components/DonationsTable';

export default function MyDonationsPage() {
  const { data: session } = useSession();
  const [donations, setDonations] = useState<DonationRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const token = extractToken(session as any);
        const data = await fetchJson('/api/donations?scope=mine', {
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          cache: 'no-store',
        });
        setDonations(data as DonationRow[]);
      } catch (e: any) {
        setError(e?.message || String(e));
        setDonations(null);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [session]);

  return (
    <div style={{ maxWidth: 1200, margin: '2rem auto', padding: '1rem' }}>
      <h2 style={{ marginBottom: '1rem' }}>Meine Zuwendungsbescheide</h2>

      {loading && <div style={{ color: 'var(--muted)' }}>Lade Daten ...</div>}
      {error && <div>Fehler beim Laden: {error}</div>}
      {donations && <DonationsTable donations={donations} showUser={false} showProcessor={false} />}
    </div>
  );
}
