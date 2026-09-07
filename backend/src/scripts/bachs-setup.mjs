/**
 * One-time Bachs catalogue bootstrap (section 3 of billing_implementation.md).
 *
 * Creates the four recurring products the checkout flow needs and prints the
 * env lines to paste into backend/.env. Existing products with the same name
 * are reused, so the script is safe to re-run: a `billing_cycle` is immutable
 * once set, and creating a duplicate would silently split the catalogue.
 *
 *   node --env-file=.env scripts/bachs-setup.mjs
 */
const apiBaseUrl = process.env.BACHS_API_BASE_URL || 'https://sandbox-api.bachs.io';
const apiKey = process.env.BACHS_API_KEY || process.env.BACHS_SANDBOX_API_KEY;

if (!apiKey) {
    console.error('Set BACHS_API_KEY (or BACHS_SANDBOX_API_KEY) before running this script.');
    process.exit(1);
}

const catalogue = [
    { env: 'BACHS_PRODUCT_PRO_MONTHLY', name: 'Chalkboard Pro (monthly)', price: '5.00', interval: 'month' },
    { env: 'BACHS_PRODUCT_PRO_ANNUAL', name: 'Chalkboard Pro (annual)', price: '50.00', interval: 'year' },
    { env: 'BACHS_PRODUCT_TEAM_MONTHLY', name: 'Chalkboard Team (monthly)', price: '30.00', interval: 'month' },
    { env: 'BACHS_PRODUCT_TEAM_ANNUAL', name: 'Chalkboard Team (annual)', price: '300.00', interval: 'year' },
    // Per-seat add-ons. Sold with quantity = number of seats in the checkout
    // cart, and folded into `subscriptions.seats` by the webhook. $2/seat is
    // the self-serve rate for going above the ten seats the base plan buys.
    { env: 'BACHS_PRODUCT_TEAM_SEAT_MONTHLY', name: 'Chalkboard Team extra seat (monthly)', price: '2.00', interval: 'month' },
    { env: 'BACHS_PRODUCT_TEAM_SEAT_ANNUAL', name: 'Chalkboard Team extra seat (annual)', price: '20.00', interval: 'year' },
];

async function bachs(path, init = {}) {
    const response = await fetch(`${apiBaseUrl}${path}`, {
        ...init,
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            ...(init.headers || {}),
        },
        body: init.body ? JSON.stringify(init.body) : undefined,
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};
    if (!response.ok) {
        throw new Error(`${init.method || 'GET'} ${path} -> ${response.status} ${payload.detail || text}`);
    }
    return payload;
}

const existing = await bachs('/v1/products?limit=100');
const byName = new Map((existing.items || []).map((product) => [product.name, product]));
const resolved = [];

for (const entry of catalogue) {
    const found = byName.get(entry.name);
    if (found) {
        console.log(`reused  ${entry.name} -> ${found.id}`);
        resolved.push([entry.env, found.id]);
        continue;
    }

    const created = await bachs('/v1/products', {
        method: 'POST',
        headers: { 'Idempotency-Key': `chalkboard-catalogue-${entry.env.toLowerCase()}` },
        body: {
            name: entry.name,
            description: `${entry.name} subscription for Chalkboard.`,
            price: { amount: entry.price, currency: 'USD' },
            billing_cycle: { interval: entry.interval, frequency: 1 },
        },
    });
    console.log(`created ${entry.name} -> ${created.id}`);
    resolved.push([entry.env, created.id]);
}

console.log('\nAdd these to backend/.env:\n');
for (const [key, id] of resolved) console.log(`${key}=${id}`);
console.log('\nThen register the webhook endpoint in the Bachs developer portal at');
console.log('  <public-origin>/api/billing/webhook');
console.log('subscribed to checkout.completed, checkout.expired, customer.subscription.created,');
console.log('customer.subscription.updated, customer.subscription.deleted, invoice.paid,');
console.log('invoice.payment_failed, and copy the signing secret into BACHS_WEBHOOK_SECRET.');
