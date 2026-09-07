const PENDING_FEEDBACK_KEY = 'chalkboard:session-feedback-pending';
const OPTOUT_KEY = 'chalkboard:session-feedback-optout';
const RATED_ROOMS_KEY = 'chalkboard:session-feedback-rated-rooms';

function safeRead<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function safeWrite(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable (private mode, quota); the prompt simply
    // repeats on a later visit instead of crashing the dashboard.
  }
}

/** Remember the room the user just left, so the dashboard can ask about it. */
export function markSessionFeedbackPending(roomSlug: string) {
  try {
    sessionStorage.setItem(PENDING_FEEDBACK_KEY, JSON.stringify({ roomSlug }));
  } catch {
    // No sessionStorage (rare) just means the prompt is skipped.
  }
}

/** Read and clear the pending room in one call. Returns null when none. */
export function consumePendingSessionFeedback(): string | null {
  let roomSlug: string | null = null;
  try {
    const raw = sessionStorage.getItem(PENDING_FEEDBACK_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { roomSlug?: string };
      if (parsed.roomSlug) roomSlug = parsed.roomSlug;
    }
    sessionStorage.removeItem(PENDING_FEEDBACK_KEY);
  } catch {
    // Ignore malformed or unavailable storage.
  }
  return roomSlug;
}

export function isSessionFeedbackOptedOut() {
  return localStorage.getItem(OPTOUT_KEY) === '1';
}

export function setSessionFeedbackOptOut(optedOut: boolean) {
  if (optedOut) localStorage.setItem(OPTOUT_KEY, '1');
  else localStorage.removeItem(OPTOUT_KEY);
}

export function hasRatedRoom(roomSlug: string) {
  const rated = safeRead<string[]>(RATED_ROOMS_KEY, []);
  return Array.isArray(rated) && rated.includes(roomSlug);
}

export function markRoomRated(roomSlug: string) {
  const rated = safeRead<string[]>(RATED_ROOMS_KEY, []);
  if (!Array.isArray(rated) || rated.includes(roomSlug)) return;
  safeWrite(RATED_ROOMS_KEY, [...rated, roomSlug]);
}