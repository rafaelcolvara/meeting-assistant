'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { getAccessToken, refreshAccessToken } from '../lib/auth';

type ProtectedRouteProps = {
  children: React.ReactNode;
};

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const router = useRouter();

  useEffect(() => {
    let mounted = true;

    async function validate() {
      const token = getAccessToken();
      if (token) {
        return;
      }

      const refreshed = await refreshAccessToken();
      if (!refreshed && mounted) {
        router.replace('/login');
      }
    }

    validate();

    return () => {
      mounted = false;
    };
  }, [router]);

  return <>{children}</>;
}
