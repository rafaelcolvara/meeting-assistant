'use client';

import { ProtectedRoute } from '../../components/ProtectedRoute';

export default function DashboardPage() {
  return (
    <ProtectedRoute>
      <main>
        <h1>Dashboard</h1>
        <p>Área protegida por middleware e refresh token.</p>
      </main>
    </ProtectedRoute>
  );
}
