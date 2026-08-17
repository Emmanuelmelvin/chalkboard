import { useState } from 'react';
import { ArrowUpRight, Heart, LoaderCircle } from 'lucide-react';
import { Link } from 'wouter';
import { apiRequest } from '@/api/client';
import '@/styles/PublicPages.css';

const PRESETS = [5, 10, 25, 50];
const CURRENCIES = ['USD', 'NGN'] as const;
type Currency = typeof CURRENCIES[number];

const CURRENCY_SYMBOLS: Record<Currency, string> = {
  USD: '$',
  NGN: '₦',
};

function Support() {
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<Currency>('USD');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Check for cancelled param
  const cancelled = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('cancelled');

  const handleSubmit = async () => {
    const numAmount = Number(amount);
    if (!numAmount || numAmount < 1 || numAmount > 10000) {
      setError('Please enter an amount between 1 and 10,000.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const data = await apiRequest<{ checkoutUrl: string }>({
        url: '/support/checkout',
        method: 'POST',
        data: { amount: numAmount, currency },
      });
      window.location.href = data.checkoutUrl;
    } catch (err: any) {
      setError(err?.message || 'Something went wrong. Please try again.');
      setLoading(false);
    }
  };

  const selectPreset = (value: number) => {
    setAmount(String(value));
    setError('');
  };

  return (
    <div className="home-page support-page">
      <header className="home-nav">
        <Link className="home-brand" href="/" aria-label="Chalkboard home">
          <span className="home-brand-mark">C</span>
          <span>Chalkboard</span>
        </Link>
      </header>

      <main className="support-main">
        <div className="support-card">
          <div className="support-icon">
            <Heart size={28} strokeWidth={1.5} />
          </div>
          <h1 className="support-title">Support Chalkboard</h1>
          <p className="support-description">
            Chalkboard is built by a small team and your support helps keep the lights on during this beta.
            Every contribution — large or small — makes a difference.
          </p>

          {cancelled && (
            <p className="support-cancelled">Payment was cancelled. No charge was made.</p>
          )}

          <div className="support-currency-toggle">
            {CURRENCIES.map((c) => (
              <button
                key={c}
                type="button"
                className={`support-currency-btn${currency === c ? ' is-active' : ''}`}
                onClick={() => setCurrency(c)}
              >
                {CURRENCY_SYMBOLS[c]} {c}
              </button>
            ))}
          </div>

          <div className="support-presets">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                className={`support-preset${amount === String(p) ? ' is-active' : ''}`}
                onClick={() => selectPreset(p)}
              >
                {CURRENCY_SYMBOLS[currency]}{p}
              </button>
            ))}
          </div>

          <div className="support-input-group">
            <span className="support-input-symbol">{CURRENCY_SYMBOLS[currency]}</span>
            <input
              id="support-amount"
              className="support-input"
              type="number"
              min="1"
              max="10000"
              step="any"
              placeholder="Enter amount"
              value={amount}
              onChange={(e) => { setAmount(e.target.value); setError(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleSubmit(); }}
              disabled={loading}
              autoFocus
            />
          </div>

          {error && <p className="support-error">{error}</p>}

          <button
            id="support-submit"
            className="home-button home-button-gold support-submit"
            type="button"
            onClick={handleSubmit}
            disabled={loading || !amount}
          >
            {loading ? (
              <><LoaderCircle className="dashboard-spin" size={17} /> Processing…</>
            ) : (
              <>Support Chalkboard <ArrowUpRight size={18} strokeWidth={1.8} /></>
            )}
          </button>

          <p className="support-footnote">
            You will be redirected to our secure payment partner to complete the transaction.
          </p>
        </div>
      </main>
    </div>
  );
}

export default Support;
