import { useEffect, useState, type ReactNode } from 'react';
import { io, Socket } from 'socket.io-client';
import { Redirect, Route, Switch, useLocation } from 'wouter';
import Chalkboard from '@/pages/Chalkboard';
import Home from '@/pages/Home';
import Login from '@/pages/Login';
import Dashboard from '@/pages/Dashboard';
import Docs from '@/pages/Docs';
import Guide from '@/pages/Guide';
import Lobby from '@/pages/Lobby';
import Plans from '@/pages/Plans';
import BillingReturn from '@/pages/BillingReturn';
import Support from '@/pages/Support';
import SupportThankYou from '@/pages/SupportThankYou';
import InviteAccept from '@/pages/InviteAccept';
import LoggerOutlet from '@/components/LoggerOutlet';
import ThemeToggle, { type ThemeMode } from '@/components/ThemeToggle';
import FeedbackWidget from '@/components/FeedbackWidget';
import { useAuthStore } from '@/stores/authStore';
import type { UserProfile } from '@/stores/authStore';
import { identifyUserJot } from '@/lib/userjot';
import { markSessionFeedbackPending } from '@/lib/sessionFeedback';
import { resolveSocketUrl } from '@/api/client';
import type { LeaveRoomOptions } from '@/types';
import '@/styles/PublicPages.css';

// In production the frontend is static on chalkboard.click and the API is on
// api.chalkboard.click — VITE_API_URL configures the target backend.
const socketBackendUrl = resolveSocketUrl(import.meta.env.VITE_API_URL);

// Initialize a single socket client that can be activated on demand
const socket: Socket = io(socketBackendUrl, {
  autoConnect: false,
  // Allow polling to establish the session when a LAN proxy or firewall does
  // not support WebSocket upgrades, then let Socket.IO upgrade when possible.
  transports: ['polling', 'websocket'],
  withCredentials: true,
});

const THEME_STORAGE_KEY = 'chalkboard-theme';

function getInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'dark';

  const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (savedTheme === 'light' || savedTheme === 'dark') return savedTheme;

  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function AuthLoading() {
  return (
    <div className="auth-loading" role="status" aria-live="polite">
      <span className="auth-loading-mark">C</span>
      <span>Checking your workspace…</span>
    </div>
  );
}

function getLobbyRoomCode() {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  return params.get('room') || params.get('code');
}

function RequireAuth({ children }: { children: (profile: UserProfile) => ReactNode }) {
  const [location, setLocation] = useLocation();
  const { profile, status } = useAuthStore();

  useEffect(() => {
    if (status === 'unauthenticated') {
      const destination = location.includes('?') ? location : `${location}${window.location.search}`;
      setLocation(`/login?redirect=${encodeURIComponent(destination)}`);
    }
  }, [location, setLocation, status]);

  if (status !== 'authenticated' || !profile) return <AuthLoading />;
  return <>{children(profile)}</>;
}

function App() {
  const [location, setLocation] = useLocation();
  const { hydrate, status, profile } = useAuthStore();
  const [roomPassword, setRoomPassword] = useState<string | undefined>();
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);
  const isRoomRoute = location.startsWith('/room/');

  // Tie every signed-in user's feedback actions back to their Chalkboard
  // profile, and clear it when the session ends. Inert when UserJot is not
  // configured for this build.
  useEffect(() => {
    if (status === 'authenticated' && profile) identifyUserJot(profile);
    else if (status === 'unauthenticated') identifyUserJot(null);
  }, [status, profile]);

  useEffect(() => {
    const activeTheme = isRoomRoute ? 'dark' : theme;
    document.documentElement.dataset.theme = activeTheme;
    document.documentElement.style.colorScheme = activeTheme;
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [isRoomRoute, theme]);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const handleJoinRoom = (room: string, password?: string) => {
    setRoomPassword(password);
    socket.connect();
    const targetPath = `/room/${room}`;
    setLocation(targetPath);
  };

  const handleLeaveRoom = (options?: LeaveRoomOptions) => {
    socket.disconnect();
    setRoomPassword(undefined);
    if (options?.promptSessionFeedback) {
      // We are leaving /room/:slug, so ask the dashboard about this session.
      const slug = location.replace(/^\/room\//, '').split(/[?#]/)[0];
      if (slug) markSessionFeedbackPending(slug);
    }
    setLocation('/dashboard?tab=rooms');
  };

  return (
    <>
      {!isRoomRoute && <ThemeToggle theme={theme} onToggle={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')} />}
      {!isRoomRoute && status === 'authenticated' && <FeedbackWidget />}
      <Switch>
        {/* Dynamic room route */}
        <Route path="/room/:roomId">
          {(params: { roomId: string }) => {
            const roomId = params.roomId.toLowerCase();
            return (
              <RequireAuth>
                {(user) => (
                  <Chalkboard
                    roomId={roomId}
                    userId={user.id}
                    userName={user.displayName}
                    socket={socket}
                    roomPassword={roomPassword}
                    onLeaveRoom={handleLeaveRoom}
                  />
                )}
              </RequireAuth>
            );
          }}
        </Route>

        {/* Public authentication route */}
        <Route path="/login">
          <Login />
        </Route>

        {/* Signed-in workspace dashboard */}
        <Route path="/dashboard">
          <RequireAuth>
            {(user) => <Dashboard profile={user} onJoinRoom={handleJoinRoom} />}
          </RequireAuth>
        </Route>

        {/* Public plugin documentation */}
        <Route path="/docs">
          <Docs />
        </Route>

        {/* Public end-user guide */}
        <Route path="/guide">
          <Guide />
        </Route>

        {/* Public pricing and developer revenue explainer */}
        <Route path="/plans">
          <Plans />
        </Route>

        {/* Checkout return target. Bachs returns the browser to `success_url`
            verbatim and appends nothing of its own, so the checkout reference
            has to be part of the path we hand it. The bare path is kept only so
            that a return without a reference lands somewhere sensible instead of
            falling through to the 404 route. */}
        <Route path="/billing/return/:reference">
          {({ reference }) => (
            <RequireAuth>
              {() => <BillingReturn reference={decodeURIComponent(reference)} />}
            </RequireAuth>
          )}
        </Route>
        <Route path="/billing/return">
          <Redirect to="/dashboard?tab=billing" />
        </Route>

        {/* Team workspace invite. Public at the router level: the page decides
            between sign-in, a closed invite, and the accept button, and the
            server does the email matching. */}
        <Route path="/invite/:token">
          <InviteAccept />
        </Route>

        {/* Public support / donation page — beta only */}
        <Route path="/support/thank-you">
          <SupportThankYou />
        </Route>
        <Route path="/support">
          <Support />
        </Route>

        {/* Public landing page */}
        <Route path="/">
          <Home />
        </Route>

        {/* Room entry route */}
        <Route path="/lobby/:roomId">
          {(params: { roomId: string }) => (
            <RequireAuth>
              {(user) => <Lobby initialRoomId={params.roomId} profile={user} onJoinRoom={handleJoinRoom} />}
            </RequireAuth>
          )}
        </Route>
        <Route path="/lobby">
          <RequireAuth>
            {(user) => <Lobby initialRoomId={getLobbyRoomCode()} profile={user} onJoinRoom={handleJoinRoom} />}
          </RequireAuth>
        </Route>

        {/* Catch-all fallback */}
        <Route>
          <Home />
        </Route>
      </Switch>
      <LoggerOutlet />
    </>
  );
}

export default App;
