import { useState, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import Lobby from '@/components/Lobby';
import Chalkboard from '@/components/Chalkboard';

// Initialize a single socket client that can be activated on demand
const socket: Socket = io({
  autoConnect: false,
  transports: ['websocket'],
});

function App() {
  const [userName, setUserName] = useState<string | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [initialRoomId, setInitialRoomId] = useState<string | null>(null);

  // Check URL query parameters for an active invite code on load
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    if (roomParam) {
      setInitialRoomId(roomParam.trim().toLowerCase());
    }
  }, []);

  const handleJoinRoom = (name: string, room: string) => {
    setUserName(name);
    setRoomId(room);

    // Update browser URL query string without reloading
    window.history.pushState(null, '', `?room=${room}`);

    // Connect to WebSocket backend
    socket.connect();
  };

  const handleLeaveRoom = () => {
    if (roomId) {
      socket.emit('leave-room', { roomId, userName });
    }
    socket.disconnect();
    setRoomId(null);
    setInitialRoomId(null);

    // Remove the room query string from the URL
    window.history.pushState(null, '', window.location.pathname);
  };

  return (
    <>
      {roomId && userName ? (
        <Chalkboard
          roomId={roomId}
          userName={userName}
          socket={socket}
          onLeaveRoom={handleLeaveRoom}
        />
      ) : (
        <Lobby
          initialRoomId={initialRoomId}
          onJoinRoom={handleJoinRoom}
        />
      )}
    </>
  );
}

export default App;
