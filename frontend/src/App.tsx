import { useEffect, useMemo, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { Redirect, Route, Switch, useLocation } from 'wouter';
import Auth from '@/pages/Auth';
import Dashboard from '@/pages/Dashboard';
import JoinRoom from '@/pages/JoinRoom';
import Onboarding from '@/pages/Onboarding';
import Chalkboard from '@/pages/Chalkboard';
import Lobby from '@/pages/Lobby';
import { useAuthStore } from '@/stores/authStore';
import LoggerOutlet from '@/components/LoggerOutlet';

function App() {
  const [guestName, setGuestName] = useState<string | null>(null);
  const [location, setLocation] = useLocation();
  const { user, token, loading, hydrate } = useAuthStore();
  const socket: Socket = useMemo(() => io({ autoConnect: false, transports: ['websocket'], auth: { token } }), [token]);

  useEffect(() => { void hydrate(); }, [hydrate]);

  useEffect(() => {
    if ((user || guestName) && location.startsWith('/room/') && !socket.connected) {
      socket.connect();
    }
  }, [guestName, location, socket, user]);

  const handleJoinRoom = (name: string, room: string) => {
    setGuestName(name);
    socket.connect();
    setLocation(`/room/${room}`);
  };

  const handleLeaveRoom = () => {
    socket.disconnect();
    setGuestName(null);
    setLocation(user ? '/dashboard' : '/');
  };

  if (loading) return <><div className="boot-screen">Dusting the slate...</div><LoggerOutlet /></>;

  return (
    <>
      <Switch>
      <Route path="/auth">{user ? <Redirect to={user.onboardingComplete ? '/dashboard' : '/onboarding'} /> : <Auth />}</Route>
      <Route path="/onboarding">{user ? <Onboarding /> : <Redirect to="/auth" />}</Route>
      <Route path="/dashboard">{user ? <Dashboard /> : <Redirect to="/auth" />}</Route>
      <Route path="/join/:roomId">{(params) => <JoinRoom roomId={params.roomId.toLowerCase()} />}</Route>
      <Route path="/room/:roomId">
        {(params: { roomId: string }) => {
          const roomId = params.roomId.toLowerCase();
          const displayName = user?.name ?? guestName;
          if (displayName) return <Chalkboard roomId={roomId} userName={displayName} socket={socket} onLeaveRoom={handleLeaveRoom} />;
          return <Lobby initialRoomId={roomId} onJoinRoom={handleJoinRoom} />;
        }}
      </Route>
      <Route path="/">{user ? <Redirect to={user.onboardingComplete ? '/dashboard' : '/onboarding'} /> : <Auth />}</Route>
      <Route>{<Redirect to="/" />}</Route>
      </Switch>
      <LoggerOutlet />
    </>
  );
}

export default App;
