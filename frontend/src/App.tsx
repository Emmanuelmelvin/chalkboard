import { useEffect, useState, type ReactNode } from 'react';
import { io, Socket } from 'socket.io-client';
import { Route, Switch, useLocation } from 'wouter';
import Chalkboard from '@/pages/Chalkboard';
import Home from '@/pages/Home';
import Login from '@/pages/Login';
import Dashboard from '@/pages/Dashboard';
import Lobby from '@/pages/Lobby';
import LoggerOutlet from '@/components/LoggerOutlet';
import ThemeToggle, { type ThemeMode } from '@/components/ThemeToggle';
import { useAuthStore } from '@/stores/authStore';
import type { UserProfile } from '@/stores/authStore';
import '@/styles/PublicPages.css';

// Initialize a single socket client that can be activated on demand
const socket: Socket = io({
  autoConnect: false,
  transports: ['websocket'],
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
  const { hydrate } = useAuthStore();
  const [roomPassword, setRoomPassword] = useState<string | undefined>();
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);
  const isRoomRoute = location.startsWith('/room/');

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

  const handleLeaveRoom = () => {
    socket.disconnect();
    setRoomPassword(undefined);
    setLocation('/dashboard?tab=rooms');
  };

  return (
    <>
      {!isRoomRoute && <ThemeToggle theme={theme} onToggle={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')} />}
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
