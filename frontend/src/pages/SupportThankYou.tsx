import { useEffect } from 'react';
import { Heart } from 'lucide-react';
import { Link } from 'wouter';
import PublicHeader from '@/components/PublicHeader';
import '@/styles/PublicPages.css';

function SupportThankYou() {
  useEffect(() => {
    document.title = 'Thank you — Chalkboard';
  }, []);

  return (
    <div className="home-page support-page">
      <PublicHeader activeRoute="support" />

      <main className="support-main">
        <div className="support-card support-thankyou-card">
          <div className="support-icon support-icon-done">
            <Heart size={28} strokeWidth={1.5} fill="currentColor" />
          </div>
          <h1 className="support-title">Thank you.</h1>
          <p className="support-description">
            Your support means more than you know. It goes directly toward keeping Chalkboard alive and improving
            every day during this beta.
          </p>
          <Link className="home-button home-button-gold support-home-link" href="/">
            Back to Chalkboard
          </Link>
        </div>
      </main>
    </div>
  );
}

export default SupportThankYou;
