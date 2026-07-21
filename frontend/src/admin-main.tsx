import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import AdminDashboard from '@/admin/AdminDashboard';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AdminDashboard />
  </StrictMode>,
);
