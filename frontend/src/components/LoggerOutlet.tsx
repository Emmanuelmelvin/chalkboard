import { useLoggerStore } from '@/stores/loggerStore';

export default function LoggerOutlet() {
  const { notices, dismiss } = useLoggerStore();

  return (
    <div className="logger-outlet" aria-live="polite" aria-atomic="false">
      {notices.map((notice) => (
        <button
          key={notice.id}
          type="button"
          className={`logger-notice logger-${notice.level}`}
          onClick={() => dismiss(notice.id)}
        >
          {notice.message}
        </button>
      ))}
    </div>
  );
}
