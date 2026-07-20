import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, ShieldCheck } from 'lucide-react';
import { useLocation } from 'wouter';
import { useAuthStore } from '@/stores/authStore';
import '@/styles/PublicPages.css';

interface GoogleCredentialResponse {
  credential: string;
}

interface GoogleIdentityApi {
  initialize: (options: { client_id: string; callback: (response: GoogleCredentialResponse) => void }) => void;
  renderButton: (parent: HTMLElement, options: Record<string, string | number>) => void;
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleIdentityApi } };
  }
}

function waitForGoogleIdentity() {
  if (window.google?.accounts.id) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const script = document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]');
    if (!script) {
      reject(new Error('Google Sign-In is not configured.'));
      return;
    }
    const timeout = window.setTimeout(() => reject(new Error('Google Sign-In took too long to load.')), 10000);
    script.addEventListener('load', () => {
      window.clearTimeout(timeout);
      resolve();
    }, { once: true });
    script.addEventListener('error', () => {
      window.clearTimeout(timeout);
      reject(new Error('Google Sign-In could not load.'));
    }, { once: true });
  });
}

function Login() {
  const [, setLocation] = useLocation();
  const googleButtonRef = useRef<HTMLDivElement | null>(null);
  const { profile, status, error, signInWithGoogle } = useAuthStore();
  const [setupError, setSetupError] = useState<string | null>(null);
  const [redirectTarget] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const redirect = params.get('redirect');
    return redirect?.startsWith('/') ? redirect : '/lobby';
  });

  useEffect(() => {
    if (status === 'authenticated' && profile) {
      setLocation(redirectTarget);
    }
  }, [profile, redirectTarget, setLocation, status]);

  useEffect(() => {
    let cancelled = false;
    const renderGoogleButton = async () => {
      try {
        let clientId = import.meta.env.VITE_CLIENT_ID?.trim();
        if (!clientId) {
          const configResponse = await fetch('/api/auth/google/config', { credentials: 'include' });
          const responseText = await configResponse.text();
          const config = responseText ? JSON.parse(responseText) as { clientId?: string } : {};
          clientId = config.clientId?.trim();
          if (!configResponse.ok || !clientId) throw new Error('Google Sign-In is not configured on the server.');
        }
        await waitForGoogleIdentity();
        if (cancelled || !googleButtonRef.current || !window.google) return;

        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => {
            void signInWithGoogle(response.credential).catch(() => undefined);
          },
        });
        googleButtonRef.current.replaceChildren();
        window.google.accounts.id.renderButton(googleButtonRef.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'continue_with',
          shape: 'rectangular',
          width: 360,
          logo_alignment: 'left',
        });
      } catch (setupFailure) {
        if (!cancelled) setSetupError(setupFailure instanceof Error ? setupFailure.message : 'Google Sign-In is unavailable.');
      }
    };

    void renderGoogleButton();
    return () => { cancelled = true; };
  }, [signInWithGoogle]);

  return (
    <div className="auth-page">
      <header className="auth-nav">
        <a className="home-brand" href="/" aria-label="Chalkboard home">
          <span className="home-brand-mark">C</span>
          <span>Chalkboard</span>
        </a>
        <span className="auth-nav-meta">Private workspace</span>
      </header>

      <main className="auth-main">
        <section className="auth-intro" aria-labelledby="auth-heading">
          <p className="home-eyebrow"><span className="home-eyebrow-line" />Welcome back / 01</p>
          <h1 id="auth-heading">Your ideas<br /><em>have a room.</em></h1>
          <p>Sign in to create a shared canvas, join a room, and keep the thread of your thinking in one place.</p>
          <div className="auth-intro-rule"><span />Your workspace, waiting.</div>
        </section>

        <section className="auth-panel" aria-labelledby="auth-panel-heading">
          <p className="lobby-panel-kicker">Secure access</p>
          <h2 id="auth-panel-heading">Continue to Chalkboard.</h2>
          <p className="lobby-panel-copy">Use your Google account to enter your shared workspace.</p>
          <div className="auth-google-slot" ref={googleButtonRef} aria-label="Continue with Google" />
          {(setupError || error) && <p className="lobby-error" role="alert">{setupError || error}</p>}
          <p className="lobby-panel-footnote"><ShieldCheck size={14} strokeWidth={1.7} /> Your sign-in is handled securely by Google.</p>
        </section>
      </main>

      <footer className="auth-footer">
        <span>Chalkboard / Shared thinking</span>
        <a href="/">Back to home <ArrowUpRight size={13} strokeWidth={1.7} /></a>
      </footer>
    </div>
  );
}

export default Login;
