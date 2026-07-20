import { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronRight,
  CircleHelp,
  Copy,
  DoorOpen,
  Globe2,
  LayoutDashboard,
  LibraryBig,
  LockKeyhole,
  LogOut,
  PanelTopOpen,
  PenLine,
  Plus,
  RefreshCw,
  Settings2,
  Shapes,
  Sparkles,
  Trash2,
  UserRound,
  UsersRound,
} from 'lucide-react';
import { useLocation } from 'wouter';
import { getRoomThemeLabel, roomThemes, type RoomTheme } from '@/constants/roomThemes';
import UserAvatar from '@/components/UserAvatar';
import ConfirmModal from '@/components/ui/ConfirmModal';
import { useAuthStore } from '@/stores/authStore';
import type { UserProfile } from '@/stores/authStore';
import '@/styles/PublicPages.css';

type DashboardTab = 'overview' | 'rooms' | 'toolkit' | 'profile';
type RoomAccessMode = 'open' | 'password_protected';

interface RoomSummary {
  slug: string;
  title: string;
  description: string | null;
  status: 'open' | 'closed';
  accessMode: 'open' | 'approval_required' | 'password_protected';
  theme: RoomTheme;
  voiceEnabled: boolean;
  lastActivityAt: string;
  createdAt: string;
  role: 'owner' | 'instructor' | 'viewer' | null;
  password: string | null;
}

interface DashboardProps {
  profile: UserProfile;
  onJoinRoom: (room: string, password?: string) => void;
}

const tabItems: Array<{ id: DashboardTab; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'rooms', label: 'Rooms', icon: PanelTopOpen },
  { id: 'toolkit', label: 'Toolkit', icon: LibraryBig },
  { id: 'profile', label: 'Profile', icon: UserRound },
];

const toolItems = [
  { icon: PenLine, label: 'Freehand canvas', description: 'Draw loose ideas with chalk, color, and texture.' },
  { icon: Shapes, label: 'Shapes and systems', description: 'Build diagrams, grids, arrows, and visual structure.' },
  { icon: BookOpen, label: 'Notes and links', description: 'Keep context close with editable notes and references.' },
  { icon: Sparkles, label: 'Thinking plugins', description: 'Use math, statistics, and tags without leaving the room.' },
];

const DEFAULT_DOCUMENT_TITLE = 'Chalkboard - A live canvas for shared thinking';

function getTab(location: string): DashboardTab {
  const query = location.includes('?')
    ? location.split('?')[1]
    : typeof window !== 'undefined'
      ? window.location.search.slice(1)
      : '';
  const value = new URLSearchParams(query).get('tab');
  return tabItems.some((item) => item.id === value) ? value as DashboardTab : 'overview';
}

function formatActivity(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Activity not available';
  return `Last active ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

function roomRole(room: RoomSummary) {
  return room.role || 'owner';
}

function Dashboard({ profile, onJoinRoom }: DashboardProps) {
  const [location, setLocation] = useLocation();
  const { signOut } = useAuthStore();
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [roomTitle, setRoomTitle] = useState('');
  const [roomDescription, setRoomDescription] = useState('');
  const [roomAccessMode, setRoomAccessMode] = useState<RoomAccessMode>('password_protected');
  const [roomTheme, setRoomTheme] = useState<RoomTheme>('classroom');
  const [roomCode, setRoomCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [roomsLoading, setRoomsLoading] = useState(true);
  const [deletingRoomSlug, setDeletingRoomSlug] = useState<string | null>(null);
  const [roomToDelete, setRoomToDelete] = useState<RoomSummary | null>(null);
  const [createdRoomInvite, setCreatedRoomInvite] = useState<{ slug: string; title: string; password: string } | null>(null);
  const [passwordCopied, setPasswordCopied] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [activeTab, setActiveTab] = useState<DashboardTab>(() => getTab(location));
  const firstName = profile.displayName.trim().split(/\s+/)[0] || 'friend';
  const openRooms = useMemo(() => rooms.filter((room) => room.status === 'open'), [rooms]);

  useEffect(() => {
    setActiveTab(getTab(location));
  }, [location]);

  useEffect(() => {
    document.documentElement.classList.add('dashboard-active');
    document.body.classList.add('dashboard-active');

    return () => {
      document.documentElement.classList.remove('dashboard-active');
      document.body.classList.remove('dashboard-active');
    };
  }, []);

  const selectTab = (tab: DashboardTab) => {
    setError('');
    setActiveTab(tab);
    setLocation(`/dashboard?tab=${tab}`);
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    setError('');
    try {
      await signOut();
      setLocation('/login');
    } catch {
      setSigningOut(false);
      setError('We could not log you out. Please try again.');
    }
  };

  const loadRooms = async () => {
    setRoomsLoading(true);
    try {
      const response = await fetch('/api/rooms', { credentials: 'include' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'We could not load your rooms.');
      setRooms(payload.rooms || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'We could not load your rooms.');
    } finally {
      setRoomsLoading(false);
    }
  };

  useEffect(() => {
    void loadRooms();
  }, [profile.id]);

  const handleCreateRoom = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const generatedSlug = Math.random().toString(36).slice(2, 8).toLowerCase();
      const response = await fetch('/api/rooms', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: roomTitle.trim() || `${profile.displayName}'s room`,
          slug: generatedSlug,
          description: roomDescription.trim(),
          accessMode: roomAccessMode,
          theme: roomTheme,
          voiceEnabled: false,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.room?.slug) throw new Error(payload.error || 'We could not create the room.');
      if (typeof payload.password === 'string' && payload.password) {
        setCreatedRoomInvite({ slug: payload.room.slug, title: payload.room.title, password: payload.password });
      } else {
        onJoinRoom(payload.room.slug);
      }
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'We could not create the room.');
    } finally {
      setLoading(false);
    }
  };

  const handleJoinRoom = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalizedCode = roomCode.trim().toLowerCase();
    if (!normalizedCode) {
      setError('Enter a room code to join an existing room.');
      return;
    }
    setError('');
    setLocation(`/lobby/${encodeURIComponent(normalizedCode)}`);
  };

  const openRoom = (room: RoomSummary) => {
    if (room.status === 'closed') {
      setError('Closed rooms are kept as history and cannot be reopened.');
      return;
    }
    onJoinRoom(room.slug);
  };

  const requestDeleteRoom = (room: RoomSummary) => {
    if (roomRole(room) !== 'owner' || deletingRoomSlug) return;
    setRoomToDelete(room);
  };

  const handleDeleteRoom = async () => {
    const room = roomToDelete;
    if (!room) return;
    setRoomToDelete(null);
    setError('');
    setDeletingRoomSlug(room.slug);
    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(room.slug)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'We could not delete the room.');
      setRooms((currentRooms) => currentRooms.filter((currentRoom) => currentRoom.slug !== room.slug));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'We could not delete the room.');
    } finally {
      setDeletingRoomSlug(null);
    }
  };

  const renderRoomList = (compact = false) => (
    <div className={`dashboard-room-list${compact ? ' dashboard-room-list-compact' : ''}`}>
      {roomsLoading ? (
        <div className="dashboard-empty-state"><span className="dashboard-loader" /> Loading your rooms…</div>
      ) : rooms.length === 0 ? (
        <div className="dashboard-empty-state">
          <DoorOpen size={22} strokeWidth={1.4} />
          <strong>No rooms yet.</strong>
          <span>Create a room and give the next idea somewhere to go.</span>
        </div>
      ) : rooms.map((room) => (
        <div className={`dashboard-room-row${room.status === 'closed' ? ' is-closed' : ''}`} key={room.slug}>
          <button
            className="dashboard-room-row-main"
            type="button"
            onClick={() => openRoom(room)}
            disabled={room.status === 'closed'}
          >
            <span className="dashboard-room-row-mark">
              <span className={`dashboard-room-row-live-dot${room.status === 'open' ? ' is-live' : ''}`} aria-hidden="true" />
              <span className="dashboard-sr-only">{room.status === 'open' ? 'Live' : 'Archived'}</span>
            </span>
            <span className="dashboard-room-row-copy">
              <strong>{room.title}</strong>
              <small>{room.slug} · {getRoomThemeLabel(room.theme)} · {formatActivity(room.lastActivityAt)}</small>
              {room.description && <small className="dashboard-room-description">{room.description}</small>}
              {room.accessMode === 'password_protected' && (
                <small className="dashboard-room-password">
                  {room.password ? <>Password: <code>{room.password}</code></> : 'Password protected'}
                </small>
              )}
            </span>
            <span className="dashboard-room-row-meta">
              <span
                className="dashboard-room-row-access"
                title={room.accessMode === 'open' ? 'Public room' : 'Private room'}
                aria-label={room.accessMode === 'open' ? 'Public room' : 'Private room'}
              >
                {room.accessMode === 'open' ? <Globe2 size={14} strokeWidth={1.8} /> : <LockKeyhole size={14} strokeWidth={1.8} />}
                <small>{room.accessMode === 'open' ? 'Public' : 'Private'}</small>
              </span>
              <small>{room.status === 'closed' ? 'Archived' : roomRole(room)}</small>
              {room.status === 'open' && <ChevronRight size={15} strokeWidth={1.7} />}
            </span>
          </button>
          {roomRole(room) === 'owner' && (
            <button
              className="dashboard-room-delete"
              type="button"
              onClick={() => requestDeleteRoom(room)}
              disabled={deletingRoomSlug === room.slug || Boolean(deletingRoomSlug)}
              aria-label={`Delete ${room.title}`}
            >
              <Trash2 size={14} strokeWidth={1.8} />
              <span>{deletingRoomSlug === room.slug ? 'Deleting…' : 'Delete room'}</span>
            </button>
          )}
        </div>
      ))}
    </div>
  );

  const renderOverview = () => (
    <>
      <section className="dashboard-hero-card">
        <div className="dashboard-hero-copy">
          <p className="dashboard-kicker"><span /> Workspace / today</p>
          <h2>Make the next idea <em>visible.</em></h2>
          <p>Welcome back, {firstName}. Start a shared canvas, pick up an open room, or bring a new thought into focus.</p>
          <div className="dashboard-hero-actions">
            <button className="dashboard-button dashboard-button-gold" type="button" onClick={() => selectTab('rooms')}>
              Open a room <ArrowUpRight size={16} strokeWidth={1.8} />
            </button>
            <button className="dashboard-link-button" type="button" onClick={() => selectTab('toolkit')}>
              Explore the toolkit <ChevronRight size={15} strokeWidth={1.8} />
            </button>
          </div>
        </div>
        <div className="dashboard-hero-art" aria-hidden="true">
          <div className="dashboard-orbit dashboard-orbit-one" />
          <div className="dashboard-orbit dashboard-orbit-two" />
          <span className="dashboard-art-label">ROOM / LIVE</span>
          <div className="dashboard-art-card dashboard-art-card-gold"><span>01</span><strong>Find the signal</strong><small>everyone can build on</small></div>
          <div className="dashboard-art-card dashboard-art-card-white"><span>02</span><strong>Make it shared</strong><small>then move together</small></div>
          <PenLine className="dashboard-art-pen" size={24} strokeWidth={1.2} />
        </div>
      </section>

      <section className="dashboard-stat-grid" aria-label="Workspace summary">
        <article><span>Open rooms</span><strong>{openRooms.length.toString().padStart(2, '0')}</strong><small>ready when you are</small></article>
        <article><span>Total rooms</span><strong>{rooms.length.toString().padStart(2, '0')}</strong><small>including archived work</small></article>
        <article><span>Built for</span><strong>LIVE</strong><small>shared thinking</small></article>
      </section>

      <section className="dashboard-overview-grid">
        <div className="dashboard-panel dashboard-overview-rooms">
          <div className="dashboard-panel-heading"><div><p className="dashboard-panel-kicker">Your workspace</p><h3>Recent rooms</h3></div><button className="dashboard-icon-button" type="button" onClick={() => selectTab('rooms')} aria-label="See all rooms"><ArrowUpRight size={16} /></button></div>
          {renderRoomList(true)}
        </div>
        <div className="dashboard-panel dashboard-rhythm-panel">
          <p className="dashboard-panel-kicker">A simple rhythm</p>
          <h3>Bring the room<br /><em>into the work.</em></h3>
          <div className="dashboard-rhythm-list">
            <div><span>01</span><p><strong>Open a room</strong> Give the idea somewhere to go.</p></div>
            <div><span>02</span><p><strong>Make it visible</strong> Draw the thread and add context.</p></div>
            <div><span>03</span><p><strong>Move together</strong> Leave with a clear next step.</p></div>
          </div>
        </div>
      </section>
    </>
  );

  const renderRooms = () => (
    <>
      <section className="dashboard-section-intro">
        <div><p className="dashboard-kicker"><span /> Room access / 01</p><h2>Give the idea<br /><em>a room.</em></h2></div>
        <p>Create a live canvas for a workshop, a lesson, a sketch session, or the thought that is not ready to be neat yet.</p>
      </section>
      <section className="dashboard-room-workspace">
        <div className="dashboard-panel dashboard-room-create">
          <p className="dashboard-panel-kicker">New canvas</p>
          <h3>Start with a blank page.</h3>
          <p className="dashboard-panel-copy">Open a private-by-default room in a few seconds.</p>
          <form className="dashboard-form" onSubmit={handleCreateRoom}>
            <label htmlFor="dashboard-room-title">Room name</label>
            <input id="dashboard-room-title" value={roomTitle} onChange={(event) => setRoomTitle(event.target.value)} placeholder={`${profile.displayName}'s room`} />
            <label htmlFor="dashboard-room-description">Room description</label>
            <textarea
              id="dashboard-room-description"
              className="dashboard-form-textarea"
              value={roomDescription}
              onChange={(event) => setRoomDescription(event.target.value.slice(0, 280))}
              placeholder="What is this room for?"
              maxLength={280}
              rows={3}
            />
            <small className="dashboard-character-count">{roomDescription.length}/280</small>
            <fieldset className="dashboard-access-fieldset">
              <legend>Room access</legend>
              <div className="dashboard-access-grid">
                <label className={`dashboard-access-option${roomAccessMode === 'password_protected' ? ' is-selected' : ''}`}>
                  <input type="radio" name="room-access" value="password_protected" checked={roomAccessMode === 'password_protected'} onChange={() => setRoomAccessMode('password_protected')} />
                  <span><strong>Private by default</strong><small>We generate a password for you to share.</small></span>
                </label>
                <label className={`dashboard-access-option${roomAccessMode === 'open' ? ' is-selected' : ''}`}>
                  <input type="radio" name="room-access" value="open" checked={roomAccessMode === 'open'} onChange={() => setRoomAccessMode('open')} />
                  <span><strong>Open room</strong><small>Anyone with the code can join.</small></span>
                </label>
              </div>
            </fieldset>
            <fieldset className="dashboard-theme-fieldset">
              <legend>Room theme</legend>
              <div className="dashboard-theme-grid">
                {roomThemes.map((theme) => (
                  <label className={`dashboard-theme-option${roomTheme === theme.id ? ' is-selected' : ''}`} key={theme.id}>
                    <input
                      type="radio"
                      name="room-theme"
                      value={theme.id}
                      checked={roomTheme === theme.id}
                      onChange={() => setRoomTheme(theme.id)}
                    />
                    <span className={`dashboard-theme-swatch dashboard-theme-swatch-${theme.id}`} aria-hidden="true" />
                    <span className="dashboard-theme-copy"><strong>{theme.label}</strong><small>{theme.description}</small></span>
                  </label>
                ))}
              </div>
            </fieldset>
            <button className="dashboard-button dashboard-button-dark" type="submit" disabled={loading}>
              <Plus size={15} strokeWidth={2} /> {loading ? 'Creating room…' : 'Create a new room'}
            </button>
          </form>
          <div className="dashboard-divider"><span>or join an existing room</span></div>
          <form className="dashboard-form dashboard-join-form" onSubmit={handleJoinRoom}>
            <label htmlFor="dashboard-room-code">Room code</label>
            <div className="dashboard-join-row"><input id="dashboard-room-code" value={roomCode} onChange={(event) => setRoomCode(event.target.value)} placeholder="e.g. field-notes" autoComplete="off" /><button className="dashboard-button dashboard-button-outline" type="submit" disabled={loading}>Join <ArrowUpRight size={15} /></button></div>
          </form>
          {error && <p className="dashboard-error" role="alert">{error}</p>}
        </div>
        <div className="dashboard-panel dashboard-room-list-panel">
          <div className="dashboard-panel-heading"><div><p className="dashboard-panel-kicker">Your rooms</p><h3>Pick up where you left off.</h3></div><button className="dashboard-icon-button" type="button" onClick={() => { void loadRooms(); }} aria-label="Refresh rooms"><RefreshCw size={15} /></button></div>
          {renderRoomList()}
        </div>
      </section>
    </>
  );

  const renderToolkit = () => (
    <>
      <section className="dashboard-section-intro">
        <div><p className="dashboard-kicker"><span /> Your tools / 03</p><h2>Make thinking<br /><em>tangible.</em></h2></div>
        <p>Everything in a Chalkboard room is designed to keep the thought moving—from the first mark to the useful next step.</p>
      </section>
      <section className="dashboard-tool-grid">
        {toolItems.map(({ icon: Icon, label, description }, index) => (
          <article className="dashboard-tool-card" key={label}>
            <div className="dashboard-tool-card-top"><span>0{index + 1}</span><Icon size={22} strokeWidth={1.4} /></div>
            <h3>{label}</h3><p>{description}</p><span className="dashboard-tool-card-arrow"><ArrowUpRight size={16} /></span>
          </article>
        ))}
      </section>
    </>
  );

  const renderProfile = () => (
    <>
      <section className="dashboard-section-intro">
        <div><p className="dashboard-kicker"><span /> Workspace identity / 04</p><h2>Your place<br /><em>in the room.</em></h2></div>
        <p>Your Google account is used to keep your rooms private and give collaborators a clear name and presence.</p>
      </section>
      <section className="dashboard-profile-grid">
        <div className="dashboard-panel dashboard-profile-card">
          <UserAvatar name={profile.displayName} avatarUrl={profile.avatarUrl} size="lg" />
          <p className="dashboard-panel-kicker">Signed in as</p>
          <h3>{profile.displayName}</h3>
          <p>{profile.email}</p>
          <div className="dashboard-profile-rule" />
          <button className="dashboard-button dashboard-button-outline" type="button" onClick={() => { void handleSignOut(); }} disabled={signingOut}>
            <LogOut size={15} /> {signingOut ? 'Logging out...' : 'Log out'}
          </button>
        </div>
        <div className="dashboard-panel dashboard-account-notes">
          <p className="dashboard-panel-kicker">Account notes</p>
          <div><Settings2 size={18} /><p><strong>Private by default</strong> Your rooms are only accessible to people who have the room code or an approved invitation.</p></div>
          <div><UsersRound size={18} /><p><strong>Built for collaboration</strong> Everyone in a room can draw, react, raise a hand, and see the shared canvas update live.</p></div>
          <div><CircleHelp size={18} /><p><strong>Room lifecycle</strong> Inactive rooms are archived automatically after 24 hours and cannot be reopened.</p></div>
        </div>
      </section>
    </>
  );

  const tabTitle = tabItems.find((item) => item.id === activeTab)?.label || 'Overview';

  useEffect(() => {
    document.title = `${tabTitle} - Chalkboard`;

    return () => {
      document.title = DEFAULT_DOCUMENT_TITLE;
    };
  }, [tabTitle]);

  return (
    <>
      <div className="dashboard-page">
      <aside className="dashboard-rail">
        <button className="dashboard-brand" type="button" onClick={() => setLocation('/')} aria-label="Chalkboard home"><span className="home-brand-mark">C</span><span>Chalkboard</span></button>
        <div className="dashboard-rail-rule" />
        <p className="dashboard-rail-label">Workspace</p>
        <nav className="dashboard-tabs" aria-label="Dashboard sections">
          {tabItems.map(({ id, label, icon: Icon }) => (
            <button className={`dashboard-tab${activeTab === id ? ' is-active' : ''}`} type="button" key={id} onClick={() => selectTab(id)} aria-current={activeTab === id ? 'page' : undefined}>
              <Icon size={17} strokeWidth={activeTab === id ? 1.9 : 1.5} /><span>{label}</span>{id === 'rooms' && openRooms.length > 0 && <small>{openRooms.length}</small>}
            </button>
          ))}
        </nav>
        <div className="dashboard-rail-bottom">
          <div className="dashboard-rail-status"><span /> Redis-backed live canvas</div>
          <button className="dashboard-help" type="button" onClick={() => selectTab('toolkit')}><CircleHelp size={15} /> Need a starting point?</button>
          <div className="dashboard-mini-profile"><UserAvatar name={profile.displayName} avatarUrl={profile.avatarUrl} size="sm" /><span><strong>{firstName}</strong><small>Workspace member</small></span></div>
        </div>
      </aside>
      <main className="dashboard-main">
        <header className="dashboard-header">
          <div><p className="dashboard-header-meta">Chalkboard / {tabTitle}</p><h1>{activeTab === 'overview' ? `Good to see you, ${firstName}.` : tabTitle}</h1></div>
          <div className="dashboard-header-actions"><button className="dashboard-header-room-button" type="button" onClick={() => selectTab('rooms')}><Plus size={15} /> New room</button><UserAvatar name={profile.displayName} avatarUrl={profile.avatarUrl} size="md" /></div>
        </header>
        <div className="dashboard-content">
          {activeTab === 'overview' && renderOverview()}
          {activeTab === 'rooms' && renderRooms()}
          {activeTab === 'toolkit' && renderToolkit()}
          {activeTab === 'profile' && renderProfile()}
          {activeTab !== 'rooms' && error && <p className="dashboard-error dashboard-floating-error" role="alert">{error}</p>}
        </div>
      </main>
      </div>
      {roomToDelete && (
        <ConfirmModal
          title="Delete room?"
          message={`“${roomToDelete.title}” and its shared canvas will be permanently removed.`}
          confirmLabel="Delete room"
          danger
          variant="dashboard"
          onCancel={() => setRoomToDelete(null)}
          onConfirm={() => { void handleDeleteRoom(); }}
        />
      )}
      {createdRoomInvite && (
        <ConfirmModal
          title="Private room ready"
          message={`Share this password with everyone you want to invite to “${createdRoomInvite.title}”. They will need the room code and this password to enter.`}
          confirmLabel="Open room"
          variant="dashboard"
          onCancel={() => setCreatedRoomInvite(null)}
          onConfirm={() => {
            const invite = createdRoomInvite;
            setCreatedRoomInvite(null);
            onJoinRoom(invite.slug);
          }}
        >
          <div className="dashboard-generated-password">
            <span>Generated password</span>
            <div className="dashboard-generated-password-row">
              <code>{createdRoomInvite.password}</code>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(createdRoomInvite.password).then(() => {
                    setPasswordCopied(true);
                    window.setTimeout(() => setPasswordCopied(false), 1800);
                  });
                }}
              >
                {passwordCopied ? <Check size={14} /> : <Copy size={14} />}
                {passwordCopied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        </ConfirmModal>
      )}
    </>
  );
}

export default Dashboard;
