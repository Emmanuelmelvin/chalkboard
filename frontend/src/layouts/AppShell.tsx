import React from 'react';
import Button from '@/components/ui/Button';
import { useAuthStore } from '@/stores/authStore';

interface AppShellProps {
  children: React.ReactNode;
  title?: string;
}

export const AppShell: React.FC<AppShellProps> = ({ children, title = 'Chalkboard' }) => {
  const { user, signOut } = useAuthStore();
  return (
    <div className="app-shell">
      <aside className="chalk-sidebar">
        <div>
          <h1 className="shell-logo">Chalkboard</h1>
          <p className="shell-tagline">Rooms, invites, and live lessons wrapped around your collaborative slate.</p>
        </div>
        <nav className="shell-nav">
          <a href="/dashboard">My Rooms</a>
          <a href="/onboarding">New User Guide</a>
        </nav>
        <div className="user-menu">
          <span>{user?.name}</span>
          <small>{user?.email}</small>
          <Button variant="secondary" onClick={signOut}>Sign out</Button>
        </div>
      </aside>
      <main className="shell-main">
        <header className="shell-header"><h2>{title}</h2></header>
        {children}
      </main>
    </div>
  );
};

export default AppShell;
