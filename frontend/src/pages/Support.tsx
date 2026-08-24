import { useState } from 'react';
import {
  ArrowUpRight,
  Heart,
  LoaderCircle
} from 'lucide-react';
import PublicHeader from '@/components/PublicHeader';
import { apiRequest } from '@/api/client';
import '@/styles/PublicPages.css';

const CURRENCIES = ['USD', 'NGN'] as const;
type Currency = typeof CURRENCIES[number];

const PRESETS: Record<Currency, number[]> = {
  USD: [5, 10, 25, 50],
  NGN: [2000, 5000, 10000, 25000],
};

const LIMITS: Record<Currency, { min: number; max: number }> = {
  USD: { min: 1, max: 10000 },
  NGN: { min: 100, max: 10000000 },
};

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

  const handleCurrencyChange = (newCurrency: Currency) => {
    setCurrency(newCurrency);
    setAmount('');
    setError('');
  };

  const handleSubmit = async () => {
    const numAmount = Number(amount);
    const limit = LIMITS[currency];
    if (!numAmount || numAmount < limit.min || numAmount > limit.max) {
      setError(`Please enter an amount between ${limit.min.toLocaleString()} and ${limit.max.toLocaleString()} ${currency}.`);
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
      if (data?.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      } else {
        throw new Error('No checkout URL received.');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unable to create checkout session. Please try again.';
      setError(message);
      setLoading(false);
    }
  };

  const selectPreset = (value: number) => {
    setAmount(String(value));
    setError('');
  };

  return (
    <div className="home-page support-page">
      <PublicHeader activeRoute="support" />

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
                onClick={() => handleCurrencyChange(c)}
              >
                {CURRENCY_SYMBOLS[c]} {c}
              </button>
            ))}
          </div>

          <div className="support-presets">
            {PRESETS[currency].map((p) => (
              <button
                key={p}
                type="button"
                className={`support-preset${amount === String(p) ? ' is-active' : ''}`}
                onClick={() => selectPreset(p)}
              >
                {CURRENCY_SYMBOLS[currency]}{p.toLocaleString()}
              </button>
            ))}
          </div>

          <div className="support-input-group">
            <span className="support-input-symbol">{CURRENCY_SYMBOLS[currency]}</span>
            <input
              id="support-amount"
              className="support-input"
              type="number"
              min={LIMITS[currency].min}
              max={LIMITS[currency].max}
              step="any"
              placeholder={`Enter amount (${LIMITS[currency].min} - ${LIMITS[currency].max.toLocaleString()})`}
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
