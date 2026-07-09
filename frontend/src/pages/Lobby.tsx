import React, { useState } from 'react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Card from '@/components/ui/Card';

interface LobbyProps {
  initialRoomId: string | null;
  onJoinRoom: (userName: string, roomId: string) => void;
}

export const Lobby: React.FC<LobbyProps> = ({ initialRoomId, onJoinRoom }) => {
  const [userName, setUserName] = useState('');
  const [roomCode, setRoomCode] = useState(initialRoomId || '');

  const handleCreateRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!userName.trim()) {
      alert('Please enter your name.');
      return;
    }
    const generatedId = Math.random().toString(36).substring(2, 8).toLowerCase();
    onJoinRoom(userName.trim(), generatedId);
  };

  const handleJoinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!userName.trim()) {
      alert('Please enter your name.');
      return;
    }
    if (!roomCode.trim()) {
      alert('Please enter a room code.');
      return;
    }
    onJoinRoom(userName.trim(), roomCode.trim().toLowerCase());
  };

  return (
    <div className="lobby-container">
      <Card variant="slate">
        <div className="lobby-content">
          <h1 className="lobby-logo">Chalkboard</h1>
          <p className="lobby-subtitle">Collaborative Real-time Workspace</p>

          <form className="lobby-form" onSubmit={initialRoomId ? handleJoinRoom : (e) => e.preventDefault()}>
            <Input
              id="name-input"
              label="YOUR NAME"
              type="text"
              maxLength={16}
              placeholder="Enter your nickname..."
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              required
            />

            {initialRoomId ? (
              <div className="lobby-form">
                <Input
                  id="room-input"
                  label="JOINING ROOM"
                  type="text"
                  value={roomCode}
                  disabled
                />
                <Button type="submit" onClick={handleJoinRoom}>
                  Enter Chalkboard
                </Button>
              </div>
            ) : (
              <div className="lobby-form" style={{ gap: '16px' }}>
                <Button type="button" onClick={handleCreateRoom}>
                  Create New Chalkboard
                </Button>

                <div className="lobby-divider-text">OR</div>

                <Input
                  id="code-input"
                  label="JOIN EXISTING ROOM"
                  type="text"
                  placeholder="Enter 6-char room code..."
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value)}
                />
                <Button type="button" variant="secondary" onClick={handleJoinRoom}>
                  Join Room
                </Button>
              </div>
            )}
          </form>
        </div>
      </Card>
    </div>
  );
};

export default Lobby;
