import { useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { Route, Switch, useLocation } from 'wouter';
import Lobby from '@/pages/Lobby';
import Chalkboard from '@/pages/Chalkboard';

// Initialize a single socket client that can be activated on demand
const socket: Socket = io({
  autoConnect: false,
  transports: ['websocket'],
});

function App() {
  const [userName, setUserName] = useState<string | null>(null);
  const [, setLocation] = useLocation();

  const handleJoinRoom = (name: string, room: string) => {
    setUserName(name);

    // Connect to WebSocket backend
    socket.connect();

    // Redirect to the chalkboard room path
    setLocation(`/room/${room}`);
  };

  const handleLeaveRoom = () => {
    socket.disconnect();
    setUserName(null);

    // Redirect back to the landing lobby
    setLocation('/');
  };

  return (
    <Switch>
      {/* Dynamic room route */}
      <Route path="/room/:roomId">
        {(params: { roomId: string }) => {
          const roomId = params.roomId.toLowerCase();

          if (userName) {
            return (
              <Chalkboard
                roomId={roomId}
                userName={userName}
                socket={socket}
                onLeaveRoom={handleLeaveRoom}
              />
            );
          } else {
            // Guard: If the user directly browses to a room URL without setting their name,
            // render the Lobby to capture their nickname for this specific room code.
            return (
              <Lobby
                initialRoomId={roomId}
                onJoinRoom={handleJoinRoom}
              />
            );
          }
        }}
      </Route>

      {/* Default lobby route */}
      <Route path="/">
        <Lobby
          initialRoomId={null}
          onJoinRoom={handleJoinRoom}
        />
      </Route>

      {/* Catch-all fallback */}
      <Route>
        <Lobby
          initialRoomId={null}
          onJoinRoom={handleJoinRoom}
        />
      </Route>
    </Switch>
  );
}

export default App;
