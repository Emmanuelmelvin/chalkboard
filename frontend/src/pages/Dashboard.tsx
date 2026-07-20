import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import AppShell from '@/layouts/AppShell';
import { useAuthStore } from '@/stores/authStore';
import { useRoomsStore } from '@/stores/roomsStore';
import type { AccessMode, CreateRoomInput, RoomSummary } from '@/types/app';

const defaultForm: CreateRoomInput = { title: '', accessMode: 'open', maxAttendees: 25, voiceEnabled: true };
const canManage = (room: RoomSummary) => room.role === 'owner' || room.role === 'instructor';

export default function Dashboard() {
  const token = useAuthStore((state) => state.token);
  const { rooms, loading, error, loadRooms, createRoom, updateRoom } = useRoomsStore();
  const [, setLocation] = useLocation();
  const [form, setForm] = useState<CreateRoomInput>(defaultForm);
  const [selected, setSelected] = useState<RoomSummary | null>(null);
  const [inviteCode, setInviteCode] = useState('');

  useEffect(() => { if (token) void loadRooms(token); }, [token, loadRooms]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!token || !form.title.trim()) return;
    const room = await createRoom({ ...form, title: form.title.trim() }, token);
    setForm(defaultForm);
    setLocation(`/room/${room.id}`);
  };

  const saveSelected = async () => {
    if (!token || !selected) return;
    await updateRoom(selected.id, {
      title: selected.title,
      accessMode: selected.accessMode,
      maxAttendees: selected.maxAttendees,
      voiceEnabled: selected.voiceEnabled,
    }, token);
  };

  return (
    <AppShell title="Dashboard">
      <div className="dashboard-grid">
        <section className="chalk-card room-list-card">
          <div className="section-heading"><h3>My rooms</h3>{loading && <span>Loading...</span>}</div>
          {error && <p className="chalk-error">{error}</p>}
          {rooms.length === 0 && !loading ? <p className="empty-state">No rooms yet. Create your first chalkboard or paste an invite code.</p> : null}
          <div className="room-list">
            {rooms.map((room) => (
              <button className="room-row" key={room.id} onClick={() => setSelected(room)}>
                <span><strong>{room.title}</strong><small>{room.role} · {room.attendeeCount}/{room.maxAttendees} live · {room.accessMode}</small></span>
                <Button type="button" onClick={(event) => { event.stopPropagation(); setLocation(`/room/${room.id}`); }}>Open</Button>
              </button>
            ))}
          </div>
        </section>

        <section className="chalk-card">
          <h3>Create room</h3>
          <form className="dashboard-form" onSubmit={submit}>
            <Input label="ROOM TITLE" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Algebra review" />
            <label>ACCESS MODE<select value={form.accessMode} onChange={(e) => setForm({ ...form, accessMode: e.target.value as AccessMode })}><option value="open">Open</option><option value="approval-required">Approval required</option><option value="password">Password</option></select></label>
            {form.accessMode === 'password' && <Input label="ROOM PASSWORD" type="password" value={form.password ?? ''} onChange={(e) => setForm({ ...form, password: e.target.value })} />}
            <Input label="MAX ATTENDEES" type="number" min={1} max={250} value={form.maxAttendees} onChange={(e) => setForm({ ...form, maxAttendees: Number(e.target.value) })} />
            <label className="toggle-row"><input type="checkbox" checked={form.voiceEnabled} onChange={(e) => setForm({ ...form, voiceEnabled: e.target.checked })} /> Voice via LiveKit</label>
            <Button type="submit">Create and enter</Button>
          </form>
        </section>

        <section className="chalk-card">
          <h3>Join by link</h3>
          <p>Paste a room id or an invite URL. Guests can continue to the invite page; signed-in users join with their session.</p>
          <div className="join-row"><Input value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} placeholder="/join/abc123" /><Button onClick={() => setLocation(`/join/${inviteCode.split('/').filter(Boolean).pop() ?? ''}`)}>Join</Button></div>
        </section>

        {selected && canManage(selected) && (
          <section className="chalk-card settings-card">
            <h3>Room settings</h3>
            <Input label="TITLE" value={selected.title} onChange={(e) => setSelected({ ...selected, title: e.target.value })} />
            <label>ACCESS MODE<select value={selected.accessMode} onChange={(e) => setSelected({ ...selected, accessMode: e.target.value as AccessMode })}><option value="open">Open</option><option value="approval-required">Approval required</option><option value="password">Password</option></select></label>
            <Input label="MAX ATTENDEES" type="number" value={selected.maxAttendees} onChange={(e) => setSelected({ ...selected, maxAttendees: Number(e.target.value) })} />
            <label className="toggle-row"><input type="checkbox" checked={selected.voiceEnabled} onChange={(e) => setSelected({ ...selected, voiceEnabled: e.target.checked })} /> Voice enabled</label>
            <div className="member-list"><strong>Members</strong>{selected.members?.map((member) => <div key={member.id} className="member-row"><span>{member.name}<small>{member.role} · {member.status}</small></span>{selected.role === 'owner' && member.role !== 'owner' && <Button variant="secondary">Kick</Button>}</div>) ?? <small>Member management appears when backend returns members.</small>}</div>
            <div className="invite-list"><strong>Invites</strong>{selected.invites?.map((invite) => <code key={invite.id}>{invite.revoked ? 'revoked: ' : ''}{invite.url}</code>) ?? <code>{selected.inviteUrl ?? 'No invite returned yet'}</code>}</div>
            <Button onClick={saveSelected}>Save settings</Button>
          </section>
        )}
      </div>
    </AppShell>
  );
}
