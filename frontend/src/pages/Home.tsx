import { useState } from 'react';
import {
  ArrowDown,
  ArrowUpRight,
  Check,
  Layers3,
  MessageCircle,
  MousePointer2,
  PenLine,
  Shapes,
  Sparkles,
  UsersRound,
} from 'lucide-react';
import { Link, useLocation } from 'wouter';
import '@/styles/PublicPages.css';

const features = [
  {
    icon: PenLine,
    index: '01',
    title: 'Think in public',
    description: 'Sketch, map, and make the half-formed idea visible before it disappears.',
  },
  {
    icon: UsersRound,
    index: '02',
    title: 'Work in sync',
    description: 'Bring the room together with live cursors, reactions, and one shared point of view.',
  },
  {
    icon: Shapes,
    index: '03',
    title: 'Make it yours',
    description: 'Use notes, shapes, links, and focused tools to give every thought a place to land.',
  },
];

const showcasePanels = [
  {
    label: 'A canvas that keeps up',
    title: 'Start loose. Find the shape.',
    description: 'Freehand strokes, structured shapes, and rich notes live side by side so the thinking can stay fluid.',
    icon: PenLine,
    items: ['Freehand strokes', 'Shapes and visual systems', 'Rich, editable notes'],
    metric: 'UNLIMITED / SPACE',
  },
  {
    label: 'A room that feels present',
    title: 'Everyone gets a seat.',
    description: 'See who is in the room, respond in the moment, and keep momentum without adding another meeting layer.',
    icon: UsersRound,
    items: ['Live collaborator presence', 'Reactions and raise hand', 'Room-level connection status'],
    metric: 'REAL-TIME / BY DEFAULT',
  },
  {
    label: 'Tools for the next move',
    title: 'Turn insight into action.',
    description: 'Add context with links, tags, math tools, and statistics without leaving the conversation.',
    icon: Sparkles,
    items: ['Built-in thinking tools', 'Links and reusable references', 'A workspace that grows with you'],
    metric: 'ONE / SHARED / THREAD',
  },
];

function Home() {
  const [, setLocation] = useLocation();
  const [activeFeature, setActiveFeature] = useState(0);
  const activePanel = showcasePanels[activeFeature];
  const ActiveIcon = activePanel.icon;

  return (
    <div className="home-page">
      <a className="home-skip-link" href="#home-content">
        Skip to content
      </a>

      <header className="home-nav">
        <a className="home-brand" href="/" aria-label="Chalkboard home">
          <span className="home-brand-mark">C</span>
          <span>Chalkboard</span>
        </a>

        <nav className="home-nav-links" aria-label="Main navigation">
          <a href="#capabilities">Capabilities</a>
          <a href="#workflow">How it works</a>
          <Link className="home-nav-route" href="/dashboard">Dashboard</Link>
          <Link className="home-nav-route" href="/lobby">Lobby</Link>
          <button className="home-nav-cta" type="button" onClick={() => setLocation('/dashboard?tab=rooms')}>
            Open a room <ArrowUpRight size={15} strokeWidth={1.8} />
          </button>
        </nav>
      </header>

      <main id="home-content">
        <section className="home-hero" aria-labelledby="hero-heading">
          <div className="home-hero-copy">
            <p className="home-eyebrow">
              <span className="home-eyebrow-line" />
              A shared space for unfinished ideas
            </p>
            <h1 id="hero-heading" className="home-hero-title">
              Make ideas
              <span>visible.</span>
            </h1>
            <p className="home-hero-description">
              Chalkboard is a live canvas for teams who think better together. Move from first spark to clear next step in one room.
            </p>
            <div className="home-hero-actions">
              <button className="home-button home-button-gold" type="button" onClick={() => setLocation('/dashboard?tab=rooms')}>
                Start creating <ArrowUpRight size={18} strokeWidth={1.8} />
              </button>
              <a className="home-text-link" href="#capabilities">
                See what is possible <ArrowDown size={16} strokeWidth={1.8} />
              </a>
            </div>
            <div className="home-hero-note">
              <span className="home-note-dot" />
              No setup. No blank stares. Just a room for the work.
            </div>
          </div>

          <div className="home-hero-art" aria-label="Preview of a collaborative Chalkboard room">
            <div className="home-art-orbit home-art-orbit-one" />
            <div className="home-art-orbit home-art-orbit-two" />
            <div className="home-preview-card">
              <div className="home-preview-header">
                <div className="home-preview-window-dots" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
                <span className="home-preview-room">ROOM / FIELD NOTES</span>
                <span className="home-preview-live">
                  <span /> LIVE
                </span>
              </div>
              <div className="home-preview-layout">
                <aside className="home-preview-tools" aria-hidden="true">
                  <span className="home-preview-tool active"><PenLine size={16} /></span>
                  <span className="home-preview-tool"><Shapes size={16} /></span>
                  <span className="home-preview-tool"><Layers3 size={16} /></span>
                  <span className="home-preview-tool"><MessageCircle size={16} /></span>
                </aside>
                <div className="home-preview-canvas">
                  <div className="home-preview-canvas-grid" />
                  <div className="home-preview-kicker">MONDAY / 09:41</div>
                  <h2>
                    Where the next
                    <span>idea takes shape.</span>
                  </h2>
                  <div className="home-preview-connector connector-one" />
                  <div className="home-preview-connector connector-two" />
                  <div className="home-preview-idea idea-gold">
                    <span>01</span>
                    <strong>Find the signal</strong>
                    <small>everyone can build on</small>
                  </div>
                  <div className="home-preview-idea idea-white">
                    <span>02</span>
                    <strong>Make it clear</strong>
                    <small>then make it shared</small>
                  </div>
                  <div className="home-preview-cursor cursor-gold">
                    <MousePointer2 size={15} fill="currentColor" />
                    <span>you</span>
                  </div>
                  <div className="home-preview-cursor cursor-black">
                    <MousePointer2 size={15} fill="currentColor" />
                    <span>mara</span>
                  </div>
                  <div className="home-preview-page-count">01 <span>/</span> 04</div>
                </div>
              </div>
            </div>
            <div className="home-art-caption">
              <span>THE ROOM IS THE MEDIUM</span>
              <span>SCROLL TO EXPLORE</span>
            </div>
          </div>
        </section>

        <div className="home-marquee" aria-label="Chalkboard features">
          <div className="home-marquee-track">
            <span>DRAW TOGETHER</span><i>✦</i><span>THINK OUT LOUD</span><i>✦</i><span>SHARE THE MOMENT</span><i>✦</i><span>MAKE IT VISIBLE</span><i>✦</i>
            <span>DRAW TOGETHER</span><i>✦</i><span>THINK OUT LOUD</span><i>✦</i><span>SHARE THE MOMENT</span><i>✦</i><span>MAKE IT VISIBLE</span><i>✦</i>
          </div>
        </div>

        <section className="home-section home-capabilities" id="capabilities" aria-labelledby="capabilities-heading">
          <div className="home-section-heading">
            <p className="home-eyebrow"><span className="home-eyebrow-line" />Why Chalkboard</p>
            <h2 id="capabilities-heading">Less passing around.<br /><em>More building together.</em></h2>
            <p>Good ideas rarely arrive finished. The room should make it easy to stay with them until they are.</p>
          </div>

          <div className="home-feature-grid">
            {features.map((feature, index) => {
              const Icon = feature.icon;
              const isActive = index === activeFeature;
              return (
                <button
                  className={`home-feature-card${isActive ? ' is-active' : ''}`}
                  type="button"
                  key={feature.index}
                  onClick={() => setActiveFeature(index)}
                  aria-pressed={isActive}
                >
                  <span className="home-feature-topline">
                    <span>{feature.index}</span>
                    <Icon size={21} strokeWidth={1.5} />
                  </span>
                  <span className="home-feature-title">{feature.title}</span>
                  <span className="home-feature-description">{feature.description}</span>
                  <span className="home-feature-arrow"><ArrowUpRight size={17} strokeWidth={1.7} /></span>
                </button>
              );
            })}
          </div>

          <div className="home-showcase">
            <div className="home-showcase-copy">
              <div className="home-showcase-icon"><ActiveIcon size={25} strokeWidth={1.5} /></div>
              <p className="home-showcase-label">{activePanel.label}</p>
              <h3>{activePanel.title}</h3>
              <p>{activePanel.description}</p>
              <ul>
                {activePanel.items.map((item) => (
                  <li key={item}><Check size={15} strokeWidth={2} /> {item}</li>
                ))}
              </ul>
            </div>
            <div className="home-showcase-visual">
              <div className="home-showcase-visual-top">
                <span>CHALKBOARD / LIVE</span>
                <span>{activePanel.metric}</span>
              </div>
              <div className="home-showcase-statement">
                <span className="home-showcase-number">0{activeFeature + 1}</span>
                <span className="home-showcase-visual-line" />
                <span className="home-showcase-visual-word">TOGETHER</span>
              </div>
              <div className="home-showcase-signal signal-one" />
              <div className="home-showcase-signal signal-two" />
              <div className="home-showcase-signal signal-three" />
              <span className="home-showcase-quote">“The best part is seeing the thought become real.”</span>
            </div>
          </div>
        </section>

        <section className="home-section home-workflow" id="workflow" aria-labelledby="workflow-heading">
          <div className="home-section-heading home-section-heading-centered">
            <p className="home-eyebrow"><span className="home-eyebrow-line" />A simple rhythm</p>
            <h2 id="workflow-heading">Bring the room<br /><em>into the work.</em></h2>
          </div>
          <div className="home-steps">
            <article className="home-step">
              <span className="home-step-number">01</span>
              <div><h3>Open a room</h3><p>Give the idea somewhere to go. Start a room in a few seconds and invite the people who make it better.</p></div>
            </article>
            <article className="home-step">
              <span className="home-step-number">02</span>
              <div><h3>Make it visible</h3><p>Draw the thread, add the context, and let the work take the shape it needs in real time.</p></div>
            </article>
            <article className="home-step">
              <span className="home-step-number">03</span>
              <div><h3>Leave with momentum</h3><p>Turn the shared canvas into a clear next move without losing the thinking that got you there.</p></div>
            </article>
          </div>
        </section>

        <section className="home-cta-section" aria-labelledby="cta-heading">
          <div className="home-cta-ring home-cta-ring-one" />
          <div className="home-cta-ring home-cta-ring-two" />
          <p className="home-eyebrow"><span className="home-eyebrow-line" />The next idea is already here</p>
          <h2 id="cta-heading">Give it a room<br /><em>to become.</em></h2>
          <button className="home-button home-button-gold" type="button" onClick={() => setLocation('/dashboard?tab=rooms')}>
            Open your first room <ArrowUpRight size={18} strokeWidth={1.8} />
          </button>
        </section>
      </main>

      <footer className="home-footer">
        <a className="home-brand" href="/" aria-label="Chalkboard home">
          <span className="home-brand-mark">C</span>
          <span>Chalkboard</span>
        </a>
        <span>Shared thinking, made visible.</span>
        <span>© 2026</span>
      </footer>
    </div>
  );
}

export default Home;
