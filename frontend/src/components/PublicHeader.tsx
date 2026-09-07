import { useEffect, useState } from 'react';
import { ArrowUpRight, Menu, X } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import '@/styles/PublicPages.css';

export interface PublicHeaderProps {
  activeRoute?: 'home' | 'guide' | 'plans' | 'docs' | 'support' | 'dashboard' | 'lobby' | 'login';
}

export default function PublicHeader({ activeRoute }: PublicHeaderProps) {
  const [location, setLocation] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const currentRoute =
    activeRoute ||
    (location.startsWith('/guide')
      ? 'guide'
      : location.startsWith('/plans')
      ? 'plans'
      : location.startsWith('/docs')
      ? 'docs'
      : location.startsWith('/support')
      ? 'support'
      : location.startsWith('/dashboard')
      ? 'dashboard'
      : location.startsWith('/lobby')
      ? 'lobby'
      : location === '/'
      ? 'home'
      : undefined);

  useEffect(() => {
    if (!mobileMenuOpen) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileMenuOpen(false);
    };

    document.body.classList.add('home-mobile-menu-open');
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.classList.remove('home-mobile-menu-open');
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [mobileMenuOpen]);

  const closeMobileMenu = () => setMobileMenuOpen(false);

  return (
    <>
      <header className="home-nav">
        <Link className="home-brand" href="/" aria-label="Chalkboard home">
          <span className="home-brand-mark">C</span>
          <span>Chalkboard</span>
        </Link>

        <nav className="home-nav-links" aria-label="Main navigation">
          <Link
            className={`home-nav-route${currentRoute === 'guide' ? ' is-active' : ''}`}
            aria-current={currentRoute === 'guide' ? 'page' : undefined}
            href="/guide"
          >
            Guide
          </Link>
          <Link
            className={`home-nav-route${currentRoute === 'plans' ? ' is-active' : ''}`}
            aria-current={currentRoute === 'plans' ? 'page' : undefined}
            href="/plans"
          >
            Plans
          </Link>
          <Link
            className={`home-nav-route${currentRoute === 'docs' ? ' is-active' : ''}`}
            aria-current={currentRoute === 'docs' ? 'page' : undefined}
            href="/docs"
          >
            Docs
          </Link>
          <Link
            className={`home-nav-route${currentRoute === 'support' ? ' is-active' : ''}`}
            aria-current={currentRoute === 'support' ? 'page' : undefined}
            href="/support"
          >
            Support
          </Link>
          <Link
            className={`home-nav-route${currentRoute === 'dashboard' ? ' is-active' : ''}`}
            aria-current={currentRoute === 'dashboard' ? 'page' : undefined}
            href="/dashboard"
          >
            Dashboard
          </Link>
          <Link
            className={`home-nav-route${currentRoute === 'lobby' ? ' is-active' : ''}`}
            aria-current={currentRoute === 'lobby' ? 'page' : undefined}
            href="/lobby"
          >
            Lobby
          </Link>
          <button className="home-nav-cta" type="button" onClick={() => setLocation('/dashboard?tab=rooms')}>
            Open a room <ArrowUpRight size={15} strokeWidth={1.8} />
          </button>
        </nav>

        <button
          className="home-mobile-menu-button"
          type="button"
          onClick={() => setMobileMenuOpen(true)}
          aria-label="Open main menu"
          aria-expanded={mobileMenuOpen}
          aria-controls="home-mobile-drawer"
        >
          <Menu size={19} strokeWidth={1.8} />
          <span>Menu</span>
        </button>
      </header>

      <button
        className={`home-mobile-menu-backdrop${mobileMenuOpen ? ' is-visible' : ''}`}
        type="button"
        onClick={closeMobileMenu}
        aria-label="Close main menu"
        tabIndex={mobileMenuOpen ? 0 : -1}
      />
      <aside
        id="home-mobile-drawer"
        className={`home-mobile-drawer${mobileMenuOpen ? ' is-open' : ''}`}
        aria-label="Main navigation"
        aria-hidden={!mobileMenuOpen}
      >
        <div className="home-mobile-drawer-header">
          <Link className="home-brand" href="/" onClick={closeMobileMenu} aria-label="Chalkboard home">
            <span className="home-brand-mark">C</span>
            <span>Chalkboard</span>
          </Link>
          <button className="home-mobile-drawer-close" type="button" onClick={closeMobileMenu} aria-label="Close main menu">
            <X size={18} strokeWidth={1.8} />
          </button>
        </div>
        <nav className="home-mobile-drawer-nav" aria-label="Mobile navigation">
          <Link className={currentRoute === 'home' ? 'is-active' : ''} aria-current={currentRoute === 'home' ? 'page' : undefined} href="/" onClick={closeMobileMenu}>
            Home
          </Link>
          <Link className={currentRoute === 'guide' ? 'is-active' : ''} aria-current={currentRoute === 'guide' ? 'page' : undefined} href="/guide" onClick={closeMobileMenu}>
            Guide
          </Link>
          <Link className={currentRoute === 'plans' ? 'is-active' : ''} aria-current={currentRoute === 'plans' ? 'page' : undefined} href="/plans" onClick={closeMobileMenu}>
            Plans
          </Link>
          <Link className={currentRoute === 'docs' ? 'is-active' : ''} aria-current={currentRoute === 'docs' ? 'page' : undefined} href="/docs" onClick={closeMobileMenu}>
            Docs
          </Link>
          <Link className={currentRoute === 'support' ? 'is-active' : ''} aria-current={currentRoute === 'support' ? 'page' : undefined} href="/support" onClick={closeMobileMenu}>
            Support
          </Link>
          <Link className={currentRoute === 'dashboard' ? 'is-active' : ''} aria-current={currentRoute === 'dashboard' ? 'page' : undefined} href="/dashboard" onClick={closeMobileMenu}>
            Dashboard
          </Link>
          <Link className={currentRoute === 'lobby' ? 'is-active' : ''} aria-current={currentRoute === 'lobby' ? 'page' : undefined} href="/lobby" onClick={closeMobileMenu}>
            Lobby
          </Link>
        </nav>
        <button className="home-mobile-drawer-cta" type="button" onClick={() => { closeMobileMenu(); setLocation('/dashboard?tab=rooms'); }}>
          Open a room <ArrowUpRight size={16} strokeWidth={1.8} />
        </button>
      </aside>
    </>
  );
}
