import { Fragment, useEffect } from 'react';
import {
    ArrowLeft,
    ArrowUpRight,
    BadgeCheck,
    CheckCircle2,
    ChevronRight,
    CircleAlert,
    Clock,
    Coins,
    Mic,
    Puzzle,
    Sparkles,
    UsersRound,
    WalletCards,
} from 'lucide-react';
import { Link } from 'wouter';
import {
    comparisonGroups,
    developerPayoutThreshold,
    developerPoolRate,
    formatLimit,
    formatPrice,
    formatRetention,
    plans,
} from '@/constants/plans';
import { useAuthStore } from '@/stores/authStore';
import { useEntitlements } from '@/hooks/useEntitlements';
import '@/styles/Plans.css';

const planSections = [
    ['tiers', '01 / Plans'],
    ['compare', '02 / Full comparison'],
    ['retention', '03 / How retention works'],
    ['developers', '04 / Earning as a developer'],
    ['faq', '05 / Questions'],
];

/** The few points that most often decide which plan someone picks. */
const highlights = [
    {
        icon: UsersRound,
        title: 'Free is a real plan',
        description:
            'Twenty-five people in a room, five rooms at once, every access mode, and the whole built-in toolkit. No trial clock.',
    },
    {
        icon: Clock,
        title: 'Retention is the paid line',
        description:
            'Free boards are kept for seven days after their last activity. Pro and Team keep them indefinitely.',
    },
    {
        icon: Mic,
        title: 'Voice is metered honestly',
        description:
            'Voice costs us money per minute, so every plan includes an allowance rather than an all-or-nothing switch.',
    },
    {
        icon: Coins,
        title: 'Your subscription pays developers',
        description: `${Math.round(developerPoolRate * 100)}% of paid subscription revenue goes to the people whose plugins you actually use.`,
    },
];

const faqs = [
    {
        question: 'What happens to a Free board after seven days?',
        answer:
            'Nothing happens while a room is being used: the seven days are counted from the last activity in the room, not from when it was created. After that the room is closed and its canvas is cleared. Upgrading before the window closes keeps the board.',
    },
    {
        question: 'Do participants need to pay to join my room?',
        answer:
            'No. Only the person who owns the room needs a plan. Anyone you invite can join, draw, and collaborate on a free account, up to the participant limit of the owner\'s plan.',
    },
    {
        question: 'Is Team cheaper than Pro per person?',
        answer:
            'Yes, at ten seats it works out to $3 per person against $5 for Pro. Below about six people, buying individual Pro seats costs less. Team is worth it for the shared workspace, the single invoice, and member administration rather than the per-seat price alone.',
    },
    {
        question: 'What happens if I run out of voice minutes?',
        answer:
            'Voice stops working for new rooms until the allowance resets at the start of the next billing period. Everything else in the room, including the canvas and presence, keeps working normally.',
    },
    {
        question: 'Can I change or cancel a plan?',
        answer:
            'Yes, at any time. Upgrades take effect immediately and are prorated. Cancellations run to the end of the period you have already paid for, after which the account returns to Free and Free retention applies to the boards you still have.',
    },
    {
        question: 'What currency am I charged in?',
        answer:
            'Prices are listed in US dollars. At checkout you can pay in your local currency with the payment methods available in your country, including cards and bank transfer where supported.',
    },
];

function Plans() {
    const { profile, status } = useAuthStore();
    const entitlements = useEntitlements(status === 'authenticated');
    const isSignedIn = status === 'authenticated' && Boolean(profile);
    const seatedWorkspaceOwner = entitlements.summary?.workspaceRole === 'member' ? entitlements.summary.workspaceOwnerName : null;

    useEffect(() => {
        document.title = 'Plans and pricing — Chalkboard';
        document.documentElement.classList.add('plans-active');
        document.body.classList.add('plans-active');

        return () => {
            document.documentElement.classList.remove('plans-active');
            document.body.classList.remove('plans-active');
        };
    }, []);

    return (
        <div className="plans-page">
            <header className="plans-header">
                <Link className="plans-brand" href="/" aria-label="Chalkboard home">
                    <span className="plans-brand-mark">C</span>
                    <span>Chalkboard</span>
                </Link>
                <div className="plans-header-actions">
                    <span className="plans-header-label"><WalletCards size={14} /> Plans</span>
                    <Link className="plans-header-link" href="/guide"><ArrowUpRight size={14} /> User guide</Link>
                    <Link className="plans-header-link" href="/"><ArrowLeft size={14} /> Home</Link>
                </div>
            </header>

            <main className="plans-main">
                <section className="plans-hero" aria-labelledby="plans-title">
                    <div className="plans-hero-copy">
                        <p className="plans-eyebrow"><span /> Plans and pricing</p>
                        <h1 id="plans-title">Start free. Pay when the board becomes <em>worth keeping.</em></h1>
                        <p className="plans-lede">
                            Chalkboard is free for a full classroom, not a crippled demo. You move to a paid plan when you need
                            boards that persist, longer voice sessions, or a workspace your whole team shares.
                        </p>
                        <div className="plans-hero-actions">
                            <a className="plans-primary-button" href="#tiers">Compare the plans <ChevronRight size={15} /></a>
                            <Link className="plans-secondary-button" href={isSignedIn ? '/dashboard?tab=rooms' : '/login'}>
                                {isSignedIn ? 'Open your dashboard' : 'Create a free account'} <ArrowUpRight size={15} />
                            </Link>
                        </div>
                    </div>
                    <div className="plans-hero-index" aria-label="Pricing summary">
                        {plans.map((plan) => (
                            <div key={plan.id}>
                                <span>{plan.name}</span>
                                <strong>{formatPrice(plan.monthlyPrice)}</strong>
                                <small>{plan.id === 'free' ? 'Free forever' : 'per month'}</small>
                            </div>
                        ))}
                    </div>
                </section>

                <section className="plans-highlight-strip" aria-label="What decides the plan">
                    {highlights.map(({ icon: Icon, title, description }) => (
                        <article key={title}>
                            <span className="plans-card-icon"><Icon size={18} /></span>
                            <strong>{title}</strong>
                            <p>{description}</p>
                        </article>
                    ))}
                </section>

                <div className="plans-layout">
                    <aside className="plans-sidebar">
                        <p className="plans-sidebar-label">On this page</p>
                        <nav aria-label="Pricing sections">
                            {planSections.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}
                        </nav>
                    </aside>

                    <article className="plans-article">
                        <section className="plans-section plans-section-first" id="tiers">
                            <p className="plans-section-kicker">01 / Plans</p>
                            <h2>Three plans, and only one of them is a paywall.</h2>
                            <p>
                                Every plan includes the full canvas, live collaboration, presence, reactions, and the built-in
                                toolkit. The paid plans add persistence, capacity, and the parts of the plugin catalogue that pay
                                their authors.
                            </p>

                            <div className="plans-tier-grid">
                                {plans.map((plan) => {
                                    const isCurrent = isSignedIn && profile?.plan === plan.id;

                                    return (
                                        <article
                                            key={plan.id}
                                            className={`plans-tier${plan.recommended ? ' is-recommended' : ''}${isCurrent ? ' is-current' : ''}`}
                                        >
                                            <header>
                                                <div className="plans-tier-heading">
                                                    <strong>{plan.name}</strong>
                                                    {plan.recommended && <span className="plans-tier-badge">Recommended</span>}
                                                    {isCurrent && <span className="plans-tier-badge is-current">Your plan</span>}
                                                </div>
                                                <p className="plans-tier-tagline">{plan.tagline}</p>
                                                <p className="plans-tier-price">
                                                    <strong>{formatPrice(plan.monthlyPrice)}</strong>
                                                    <span>{plan.id === 'free' ? 'forever' : '/ month'}</span>
                                                </p>
                                                {plan.annualPrice && (
                                                    <p className="plans-tier-annual">
                                                        or {formatPrice(plan.annualPrice)} a year — two months off
                                                    </p>
                                                )}
                                            </header>

                                            <p className="plans-tier-description">{plan.description}</p>

                                            <ul className="plans-tier-list">
                                                <li>
                                                    <CheckCircle2 size={14} />
                                                    <span>{formatLimit(plan.limits.activeRooms)} active {plan.limits.activeRooms === 1 ? 'room' : 'rooms'}</span>
                                                </li>
                                                <li>
                                                    <CheckCircle2 size={14} />
                                                    <span>{formatLimit(plan.limits.attendeesPerRoom)} people per room</span>
                                                </li>
                                                <li>
                                                    <CheckCircle2 size={14} />
                                                    <span>{formatRetention(plan.limits.retentionDays)}</span>
                                                </li>
                                                <li>
                                                    <CheckCircle2 size={14} />
                                                    <span>{formatLimit(plan.limits.voiceMinutesPerMonth)} voice minutes a month</span>
                                                </li>
                                                <li>
                                                    <CheckCircle2 size={14} />
                                                    <span>
                                                        {plan.limits.proPlugins ? 'Full plugin catalogue' : 'Built-in and free plugins'}
                                                    </span>
                                                </li>
                                                {plan.limits.boardExport && (
                                                    <li><CheckCircle2 size={14} /><span>Board export and room branding</span></li>
                                                )}
                                                {plan.limits.seats > 1 && (
                                                    <li><CheckCircle2 size={14} /><span>{plan.limits.seats} seats in one workspace</span></li>
                                                )}
                                                {plan.limits.workspaceAdmin && (
                                                    <li><CheckCircle2 size={14} /><span>Member administration and priority support</span></li>
                                                )}
                                            </ul>

                                            {isCurrent ? (
                                                <>
                                                    <span className="plans-tier-action is-disabled">Current plan</span>
                                                    {plan.id === 'team' && seatedWorkspaceOwner && (
                                                        <p className="plans-tier-seated-note">
                                                            Seated through <strong>{seatedWorkspaceOwner}&apos;s workspace</strong>. The
                                                            workspace owner manages the plan, seats, and members.
                                                        </p>
                                                    )}
                                                </>
                                            ) : plan.id === 'free' ? (                                                <Link className="plans-tier-action" href={isSignedIn ? '/dashboard?tab=rooms' : '/login'}>
                                                    {isSignedIn ? 'Open dashboard' : 'Start free'}
                                                </Link>
                                            ) : (
                                                <Link
                                                    className={`plans-tier-action${plan.recommended ? ' is-primary' : ''}`}
                                                    href={isSignedIn ? `/dashboard?tab=billing&plan=${plan.id}` : `/login?redirect=${encodeURIComponent(`/dashboard?tab=billing&plan=${plan.id}`)}`}
                                                >
                                                    Choose {plan.name}
                                                </Link>
                                            )}
                                        </article>
                                    );
                                })}
                            </div>

                            <div className="plans-callout plans-callout-gold">
                                <Sparkles size={18} />
                                <div>
                                    <strong>Early accounts keep Pro limits</strong>
                                    <p>
                                        Accounts created while Chalkboard is in early access keep Pro-level limits at no cost. If
                                        pricing changes later, that does not change for you.
                                    </p>
                                </div>
                            </div>
                        </section>

                        <section className="plans-section" id="compare">
                            <p className="plans-section-kicker">02 / Full comparison</p>
                            <h2>Everything, line by line.</h2>
                            <p>Where a row says “Included” on every plan, it is not something we intend to meter later.</p>

                            <div className="plans-table-wrap">
                                <table className="plans-table">
                                    <thead>
                                        <tr>
                                            <th scope="col">Feature</th>
                                            {plans.map((plan) => (
                                                <th key={plan.id} scope="col" className={plan.recommended ? 'is-recommended' : undefined}>
                                                    {plan.name}
                                                    <span>{formatPrice(plan.monthlyPrice)}{plan.id === 'free' ? '' : '/mo'}</span>
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {comparisonGroups.map((group) => (
                                            <Fragment key={group.title}>
                                                <tr className="plans-table-group">
                                                    <th colSpan={4} scope="colgroup">{group.title}</th>
                                                </tr>
                                                {group.rows.map((row) => (
                                                    <tr key={row.label}>
                                                        <td>
                                                            {row.label}
                                                            {row.detail && <small>{row.detail}</small>}
                                                        </td>
                                                        {row.values.map((value, index) => (
                                                            <td
                                                                key={`${row.label}-${plans[index].id}`}
                                                                className={plans[index].recommended ? 'is-recommended' : undefined}
                                                                data-empty={value === '—' ? 'true' : undefined}
                                                            >
                                                                {value}
                                                            </td>
                                                        ))}
                                                    </tr>
                                                ))}
                                            </Fragment>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </section>

                        <section className="plans-section" id="retention">
                            <p className="plans-section-kicker">03 / How retention works</p>
                            <h2>Be clear about the one thing that can lose your work.</h2>
                            <p>
                                Retention is the main difference between Free and paid, so it is worth explaining exactly rather
                                than burying it in a table.
                            </p>
                            <ol className="plans-numbered-list">
                                <li>
                                    <strong>The clock starts at the last activity.</strong>
                                    <span>Any stroke, join, or edit resets it. A room used every week never approaches its limit.</span>
                                </li>
                                <li>
                                    <strong>On Free, seven days of silence closes the room.</strong>
                                    <span>The room is closed and its canvas is cleared. A closed room cannot be reopened.</span>
                                </li>
                                <li>
                                    <strong>On Pro and Team, nothing expires.</strong>
                                    <span>Rooms stay available until you delete them yourself.</span>
                                </li>
                                <li>
                                    <strong>Upgrading rescues a board that is still open.</strong>
                                    <span>Retention is applied when the cleanup runs, so upgrading in time keeps the work.</span>
                                </li>
                            </ol>
                            <div className="plans-callout plans-callout-dark">
                                <CircleAlert size={18} />
                                <div>
                                    <strong>If a board matters, do not rely on retention</strong>
                                    <p>
                                        Export anything you need to keep, or move it to a paid plan. Treat the seven-day window as a
                                        working buffer rather than storage.
                                    </p>
                                </div>
                            </div>
                        </section>

                        <section className="plans-section" id="developers">
                            <p className="plans-section-kicker">04 / Earning as a developer</p>
                            <h2>Plugin authors are paid from what subscribers pay us.</h2>
                            <p>
                                Pro plugins are included in the subscription rather than sold one by one, so there is no per-plugin
                                price to split. Instead a fixed share of paid subscription revenue forms a monthly pool, and that
                                pool is divided according to what people actually used.
                            </p>

                            <div className="plans-formula" aria-label="How the developer pool is divided">
                                <div>
                                    <span>01</span>
                                    <strong>The pool</strong>
                                    <p>{Math.round(developerPoolRate * 100)}% of subscription revenue actually collected in the month, after payment processing.</p>
                                </div>
                                <div>
                                    <span>02</span>
                                    <strong>The measure</strong>
                                    <p>One unit for each subscriber who used your plugin on a given day. Counted once per person per day, however many times they use it.</p>
                                </div>
                                <div>
                                    <span>03</span>
                                    <strong>Your share</strong>
                                    <p>Your units divided by all units for the month, multiplied by the pool.</p>
                                </div>
                            </div>

                            <h3>Why usage is counted by day</h3>
                            <p>
                                Counting raw invocations would reward whichever plugin called the host most often, and a plugin
                                bundle is untrusted code that can call whatever it likes in a loop. Counting distinct people per day
                                cannot be inflated that way. Only subscribers on paid plans count toward the pool, because Free
                                accounts contribute nothing to it, and your own account is excluded from your own plugin.
                            </p>

                            <div className="plans-definition-grid">
                                <article>
                                    <span className="plans-card-icon"><Puzzle size={18} /></span>
                                    <strong>Publishing</strong>
                                    <p>Publishing requires a paid plan and review approval. Free and Pro plugins are both listed; only Pro plugins draw from the pool.</p>
                                </article>
                                <article>
                                    <span className="plans-card-icon"><WalletCards size={18} /></span>
                                    <strong>Accrual</strong>
                                    <p>The split runs on the first of each month for the month that just closed, and is held as a balance. Your running total is in the Developer workspace.</p>
                                </article>
                                <article>
                                    <span className="plans-card-icon"><BadgeCheck size={18} /></span>
                                    <strong>Payout</strong>
                                    <p>Balances are paid out once they reach {formatPrice(developerPayoutThreshold)}. Anything below that carries forward instead of being lost to transfer fees.</p>
                                </article>
                            </div>

                            <div className="plans-callout plans-callout-dark">
                                <CircleAlert size={18} />
                                <div>
                                    <strong>Expect small numbers early</strong>
                                    <p>
                                        While Chalkboard is young the pool is small, and an honest share of a small pool is a small
                                        amount. The payout threshold exists so that a $2 balance is not consumed by the cost of
                                        sending it.
                                    </p>
                                </div>
                            </div>

                            <Link className="plans-inline-link" href="/docs">
                                Read the plugin developer guide <ArrowUpRight size={14} />
                            </Link>
                        </section>

                        <section className="plans-section plans-final-section" id="faq">
                            <p className="plans-section-kicker">05 / Questions</p>
                            <h2>The things worth asking before you pay.</h2>
                            <div className="plans-faq-list">
                                {faqs.map((faq) => (
                                    <details key={faq.question}>
                                        <summary>{faq.question}</summary>
                                        <p>{faq.answer}</p>
                                    </details>
                                ))}
                            </div>
                            <Link className="plans-primary-button plans-final-button" href={isSignedIn ? '/dashboard?tab=rooms' : '/login'}>
                                {isSignedIn ? 'Open your dashboard' : 'Start on the free plan'} <ArrowUpRight size={15} />
                            </Link>
                        </section>
                    </article>
                </div>
            </main>
        </div>
    );
}

export default Plans;
