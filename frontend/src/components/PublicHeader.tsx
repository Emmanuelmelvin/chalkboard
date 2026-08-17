import { useEffect, useState } from 'react';
import { ArrowUpRight, Menu, X } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import '@/styles/PublicPages.css';

export interface PublicHeaderProps {
  activeRoute?: 'home' | 'guide' | 'plans' | 'docs' | 'support' | 'dashboard' | 'lobby' | 'login';
}

export default function PublicHeader({ activeRoute }: PublicHeaderProps) {
  const [, setLocation] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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
          <Link className={`home-nav-route${activeRoute === 'guide' ? ' is-active' : ''}`} href="/guide">
            Guide
          </Link>
          <Link className={`home-nav-route${activeRoute === 'plans' ? ' is-active' : ''}`} href="/plans">
            Plans
          </Link>
          <Link className={`home-nav-route${activeRoute === 'docs' ? ' is-active' : ''}`} href="/docs">
            Docs
          </Link>
          <Link className={`home-nav-route${activeRoute === 'support' ? ' is-active' : ''}`} href="/support">
            Support
          </Link>
          <Link className={`home-nav-route${activeRoute === 'dashboard' ? ' is-active' : ''}`} href="/dashboard">
            Dashboard
          </Link>
          <Link className={`home-nav-route${activeRoute === 'lobby' ? ' is-active' : ''}`} href="/lobby">
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
          <Link className={activeRoute === 'home' ? 'is-active' : ''} href="/" onClick={closeMobileMenu}>
            Home
          </Link>
          <Link className={activeRoute === 'guide' ? 'is-active' : ''} href="/guide" onClick={closeMobileMenu}>
            Guide
          </Link>
          <Link className={activeRoute === 'plans' ? 'is-active' : ''} href="/plans" onClick={closeMobileMenu}>
            Plans
          </Link>
          <Link className={activeRoute === 'docs' ? 'is-active' : ''} href="/docs" onClick={closeMobileMenu}>
            Docs
          </Link>
          <Link className={activeRoute === 'support' ? 'is-active' : ''} href="/support" onClick={closeMobileMenu}>
            Support
          </Link>
          <Link className={activeRoute === 'dashboard' ? 'is-active' : ''} href="/dashboard" onClick={closeMobileMenu}>
            Dashboard
          </Link>
          <Link className={activeRoute === 'lobby' ? 'is-active' : ''} href="/lobby" onClick={closeMobileMenu}>
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
