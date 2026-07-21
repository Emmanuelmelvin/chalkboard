import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Code2,
  Database,
  GitBranch,
  LockKeyhole,
  PackageCheck,
  ShieldCheck,
  UploadCloud,
  Workflow,
} from 'lucide-react';
import { Link } from 'wouter';
import '@/styles/Docs.css';

const manifestExample = `{
  "id": "studio.geometry",
  "name": "Geometry Studio",
  "version": "1.0.0",
  "description": "Insert reusable geometry constructions.",
  "author": "Your name",
  "permissions": ["board:read", "board:write", "selection:read"],
  "contributes": {
    "tools": [
      {
        "id": "geometry.circle",
        "label": "Circle",
        "description": "Insert a circle at the viewport center.",
        "command": "geometry.insertCircle",
        "formFields": [
          {
            "id": "radius",
            "label": "Radius",
            "type": "number",
            "defaultValue": "120"
          }
        ]
      }
    ],
    "commands": [
      {
        "id": "geometry.insertCircle",
        "title": "Geometry Studio: Insert Circle"
      }
    ],
    "selectionTools": []
  }
}`;

const bridgeExample = `const pluginId = 'studio.geometry';

const send = (message) => {
  window.parent.postMessage({ ...message, pluginId }, '*');
};

window.addEventListener('message', (event) => {
  const message = event.data;
  if (!message || message.pluginId !== pluginId) return;

  if (message.type === 'chalkboard:init') {
    send({ type: 'chalkboard:ready' });
    send({
      type: 'chalkboard:register',
      contributions: {
        tools: [{
          id: 'geometry.circle',
          label: 'Circle',
          command: 'geometry.insertCircle'
        }],
        commands: [{
          id: 'geometry.insertCircle',
          title: 'Geometry Studio: Insert Circle'
        }]
      }
    });
    return;
  }

  if (message.type === 'chalkboard:execute') {
    if (message.command === 'geometry.insertCircle') {
      // Validate message.payload, then ask the host to perform the action.
      send({
        type: 'chalkboard:command',
        command: 'geometry.insertCircle',
        payload: message.payload
      });
    }
  }
});`;

const packageTree = `geometry-studio.zip
├── manifest.json       required
├── index.js            required bundle entry
├── logo.svg            optional catalogue logo
└── README.md           optional developer notes`;

function Docs() {
  const [activeSection, setActiveSection] = useState('overview');

  useEffect(() => {
    document.documentElement.classList.add('docs-active');
    document.body.classList.add('docs-active');
    document.title = 'Plugin documentation - Chalkboard';

    return () => {
      document.documentElement.classList.remove('docs-active');
      document.body.classList.remove('docs-active');
      document.title = 'Chalkboard - A live canvas for shared thinking';
    };
  }, []);

  useEffect(() => {
    const sections = Array.from(document.querySelectorAll<HTMLElement>('.docs-section'));
    if (sections.length === 0) return undefined;

    let animationFrame = 0;
    const updateActiveSection = () => {
      if (animationFrame) return;

      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = 0;
        const activationLine = window.innerHeight * 0.35;
        let currentSection = sections[0].id;

        sections.forEach((section) => {
          if (section.getBoundingClientRect().top <= activationLine) {
            currentSection = section.id;
          }
        });

        setActiveSection((previousSection) => previousSection === currentSection ? previousSection : currentSection);
      });
    };

    updateActiveSection();
    window.addEventListener('scroll', updateActiveSection, { passive: true });
    window.addEventListener('resize', updateActiveSection);

    return () => {
      window.removeEventListener('scroll', updateActiveSection);
      window.removeEventListener('resize', updateActiveSection);
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
    };
  }, []);

  return (
    <div className="docs-page">
      <header className="docs-header">
        <Link className="docs-brand" href="/">
          <span className="home-brand-mark">C</span>
          <span>Chalkboard</span>
        </Link>
        <div className="docs-header-actions">
          <span className="docs-header-label"><BookOpen size={14} /> Plugin documentation</span>
          <Link className="docs-back-link" href="/dashboard"><ArrowLeft size={15} /> Open dashboard</Link>
        </div>
      </header>

      <main className="docs-main">
        <section className="docs-hero" aria-labelledby="docs-title">
          <div className="docs-hero-copy">
            <p className="docs-eyebrow"><span /> Developer guide / plugins</p>
            <h1>Extend Chalkboard from the dashboard, then make your idea <em>real.</em></h1>
            <p className="docs-lede">This guide explains how the plugin platform works and how to prepare a package that Chalkboard can understand, review, version, and publish. You do not need access to Chalkboard&apos;s source code. Plugin creation and updates happen in the Developer workspace.</p>
            <div className="docs-hero-actions">
              <Link className="docs-primary-button" href="/dashboard?tab=developer">Open plugin studio <ArrowUpRight size={15} /></Link>
              <a className="docs-secondary-button" href="#dashboard-flow">See the workflow <ChevronRight size={15} /></a>
            </div>
          </div>
          <div className="docs-hero-index" aria-label="Plugin platform principles">
            <div><span>Authoring</span><strong>Dashboard only</strong><small>Create and update from Developer workspace</small></div>
            <div><span>Contract</span><strong>Manifest first</strong><small>Declare capabilities before implementation runs</small></div>
            <div><span>Release</span><strong>Reviewed</strong><small>Every version is submitted and published deliberately</small></div>
          </div>
        </section>

        <div className="docs-layout">
          <aside className="docs-sidebar">
            <p className="docs-sidebar-label">On this page</p>
            <nav aria-label="Plugin documentation sections">
              <a className={activeSection === 'overview' ? 'is-active' : undefined} aria-current={activeSection === 'overview' ? 'location' : undefined} href="#overview">01 / Overview</a>
              <a className={activeSection === 'dashboard-flow' ? 'is-active' : undefined} aria-current={activeSection === 'dashboard-flow' ? 'location' : undefined} href="#dashboard-flow">02 / Dashboard workflow</a>
              <a className={activeSection === 'package' ? 'is-active' : undefined} aria-current={activeSection === 'package' ? 'location' : undefined} href="#package">03 / Package contract</a>
              <a className={activeSection === 'manifest' ? 'is-active' : undefined} aria-current={activeSection === 'manifest' ? 'location' : undefined} href="#manifest">04 / Manifest</a>
              <a className={activeSection === 'bridge' ? 'is-active' : undefined} aria-current={activeSection === 'bridge' ? 'location' : undefined} href="#bridge">05 / Runtime messages</a>
              <a className={activeSection === 'contributions' ? 'is-active' : undefined} aria-current={activeSection === 'contributions' ? 'location' : undefined} href="#contributions">06 / Contributions</a>
              <a className={activeSection === 'publishing' ? 'is-active' : undefined} aria-current={activeSection === 'publishing' ? 'location' : undefined} href="#publishing">07 / Publish</a>
              <a className={activeSection === 'updates' ? 'is-active' : undefined} aria-current={activeSection === 'updates' ? 'location' : undefined} href="#updates">08 / Update</a>
              <a className={activeSection === 'security' ? 'is-active' : undefined} aria-current={activeSection === 'security' ? 'location' : undefined} href="#security">09 / Safety</a>
              <a className={activeSection === 'checklist' ? 'is-active' : undefined} aria-current={activeSection === 'checklist' ? 'location' : undefined} href="#checklist">10 / Checklist</a>
            </nav>
          </aside>

          <article className="docs-article">
            <section className="docs-section docs-section-first" id="overview">
              <p className="docs-section-kicker">01 / Overview</p>
              <h2>What a plugin does</h2>
              <p>A Chalkboard plugin is a packaged extension with three responsibilities. It declares what it contributes, it receives commands from the host, and it returns validated actions for the host to perform. The host remains responsible for the shared board, room synchronization, permissions, and publication.</p>
              <div className="docs-feature-grid">
                <article><span className="docs-card-icon"><Workflow size={18} /></span><strong>Declare</strong><p>The manifest tells Chalkboard the plugin identity, version, permissions, tools, commands, and form fields.</p></article>
                <article><span className="docs-card-icon"><Code2 size={18} /></span><strong>Respond</strong><p>The JavaScript bundle listens for initialization and execution messages, validates input, and emits a command result.</p></article>
                <article><span className="docs-card-icon"><Database size={18} /></span><strong>Publish</strong><p>The dashboard stores each version, sends it through review, and keeps the release history intact.</p></article>
              </div>
              <div className="docs-callout docs-callout-gold"><CheckCircle2 size={18} /><div><strong>The important rule</strong><p>Plugin authors do not need access to Chalkboard application source. The supported authoring path is the dashboard: create a draft, upload the package contract, test it, submit it, and publish it from Developer workspace.</p></div></div>
            </section>

            <section className="docs-section" id="dashboard-flow">
              <p className="docs-section-kicker">02 / Dashboard workflow</p>
              <h2>Everything starts in Developer workspace</h2>
              <p>The dashboard is the single place to create and maintain your plugin. Developer mode only reveals the authoring tools; it does not change the package contract or bypass review.</p>
              <ol className="docs-numbered-list docs-dashboard-steps">
                <li><strong>Enable Developer Mode.</strong><span>Open your Profile, turn on Developer mode, and choose Developer from the workspace navigation.</span></li>
                <li><strong>Create a draft.</strong><span>Choose New plugin. Enter a globally unique plugin ID, display name, description, access plan, and first version.</span></li>
                <li><strong>Write the contract.</strong><span>Paste or upload <code>manifest.json</code>. The manifest must describe the same ID and version you entered in the form.</span></li>
                <li><strong>Upload the implementation.</strong><span>Provide the JavaScript bundle in the Plugin bundle field. You may also attach a ZIP package, logo, and optional external bundle URL.</span></li>
                <li><strong>Create the draft.</strong><span>Chalkboard validates the identity, version format, JSON shape, and artifact limits before saving the draft.</span></li>
                <li><strong>Submit for review.</strong><span>After testing the draft, submit it. Reviewers inspect the manifest, bundle, declared behavior, and package safety before approval and publication.</span></li>
              </ol>
              <div className="docs-dashboard-panels">
                <div><UploadCloud size={18} /><strong>What the dashboard accepts</strong><span>Manifest JSON, JavaScript bundle, optional ZIP archive, optional logo, and an optional bundle URL.</span></div>
                <div><LockKeyhole size={18} /><strong>What the dashboard does not do</strong><span>It does not expose the Chalkboard source tree or require developers to register imports in application code.</span></div>
              </div>
            </section>

            <section className="docs-section" id="package">
              <p className="docs-section-kicker">03 / Package contract</p>
              <h2>Prepare one clear, reviewable package</h2>
              <p>Your package should be understandable without opening the Chalkboard application. The manifest is the source of truth for identity and declared capabilities. The bundle is the executable implementation. The optional archive groups the release artifacts for distribution and review.</p>
              <pre className="docs-code docs-code-tree"><code>{packageTree}</code></pre>
              <div className="docs-contract-list">
                <div><strong><code>manifest.json</code></strong><span>Required. Valid JSON containing the plugin identity, permissions, and contributions.</span></div>
                <div><strong><code>index.js</code></strong><span>Required implementation bundle for the plugin runtime contract. Keep it self-contained and validate every incoming payload.</span></div>
                <div><strong><code>logo.svg</code></strong><span>Optional. Used as the catalogue identity for the plugin. PNG, JPEG, WebP, and SVG are accepted by the dashboard.</span></div>
                <div><strong><code>README.md</code></strong><span>Optional. Useful for release notes and human review, but it does not replace the manifest or bundle.</span></div>
              </div>
              <div className="docs-callout docs-callout-dark"><CircleAlert size={18} /><div><strong>Inline bundle versus ZIP</strong><p>The Plugin bundle field is the executable JavaScript that the review sandbox can inspect and test. The ZIP is the complete package artifact. Uploading a ZIP alone does not make its internal files discoverable unless the required bundle and manifest are also available to the dashboard workflow.</p></div></div>
            </section>

            <section className="docs-section" id="manifest">
              <p className="docs-section-kicker">04 / Manifest</p>
              <h2>Write the contract before the code</h2>
              <p>Use stable, namespaced IDs. A tool ID identifies a visible action, while its command identifies the behavior that runs when the action is selected. Keep those values consistent across the manifest, bundle, and future releases.</p>
              <pre className="docs-code"><code>{manifestExample}</code></pre>
              <div className="docs-definition-list">
                <div><strong><code>id</code></strong><span>Stable lowercase identifier. Use letters, numbers, dots, and hyphens; for example <code>studio.geometry</code>. This must match the plugin ID in the dashboard.</span></div>
                <div><strong><code>name</code></strong><span>Short human-readable name shown in the catalogue and plugin UI.</span></div>
                <div><strong><code>version</code></strong><span>Semantic version such as <code>1.0.0</code>. It must match the version entered in the dashboard. A new release uses a new version.</span></div>
                <div><strong><code>description</code></strong><span>Explain the job the plugin performs, not just the implementation technique. This is used for discovery and review context.</span></div>
                <div><strong><code>author</code></strong><span>The person, team, or organization responsible for the package.</span></div>
                <div><strong><code>permissions</code></strong><span>Declare only the access the plugin needs: <code>board:read</code>, <code>board:write</code>, <code>selection:read</code>, <code>selection:write</code>, <code>ui:panel</code>, <code>ui:modal</code>, or <code>room:sync</code>.</span></div>
                <div><strong><code>contributes</code></strong><span>Lists the tools, commands, and selection tools that the host may expose.</span></div>
              </div>
              <div className="docs-callout docs-callout-gold"><CircleAlert size={18} /><div><strong>Identity validation</strong><p>The dashboard rejects a package when <code>manifest.id</code> differs from the plugin ID or when <code>manifest.version</code> differs from the version being created. Fix the form and JSON together before submitting.</p></div></div>
            </section>

            <section className="docs-section" id="bridge">
              <p className="docs-section-kicker">05 / Runtime messages</p>
              <h2>Use the host message contract</h2>
              <p>The uploaded bundle communicates with Chalkboard through browser messages. It should not assume access to the host&apos;s internal state. Wait for initialization, announce readiness, declare contributions, and handle execution requests by command ID.</p>
              <div className="docs-message-list">
                <div><span className="docs-message-direction is-in">IN</span><div><strong><code>chalkboard:init</code></strong><p>Sent by the host with the plugin ID, declared permissions, and manifest. Use it to initialize your runtime and confirm the package identity.</p></div></div>
                <div><span className="docs-message-direction is-out">OUT</span><div><strong><code>chalkboard:ready</code></strong><p>Sent by the bundle after it has installed its listeners and is ready to receive commands.</p></div></div>
                <div><span className="docs-message-direction is-out">OUT</span><div><strong><code>chalkboard:register</code></strong><p>Sent by the bundle with the contributions it has implemented. Keep this aligned with the manifest.</p></div></div>
                <div><span className="docs-message-direction is-in">IN</span><div><strong><code>chalkboard:execute</code></strong><p>Sent by the host when a user runs a contribution. It contains the command ID and an optional payload with form values or selection IDs.</p></div></div>
                <div><span className="docs-message-direction is-out">OUT</span><div><strong><code>chalkboard:command</code></strong><p>Sent by the bundle to request a host command after validation. Return the original payload or a normalized payload the host understands.</p></div></div>
              </div>
              <pre className="docs-code"><code>{bridgeExample}</code></pre>
              <p className="docs-muted-note">The current review sandbox uses this bridge to test uploaded bundles in an isolated iframe. Approval and publication are still controlled from the dashboard; a bundle must never treat a browser message as trusted without verifying the plugin ID and validating the payload.</p>
            </section>

            <section className="docs-section" id="contributions">
              <p className="docs-section-kicker">06 / Contributions</p>
              <h2>Choose the right contribution type</h2>
              <div className="docs-contribution-list">
                <div><span>01</span><div><strong>Tools</strong><p>Actions shown in the plugin insert surface. Add <code>formFields</code> when the user needs to configure the action before execution.</p><code>tools[] → command</code></div></div>
                <div><span>02</span><div><strong>Commands</strong><p>Behavior identifiers and human-readable titles. Every command named by a tool should also be declared here.</p><code>commands[] ↔ command ID</code></div></div>
                <div><span>03</span><div><strong>Selection tools</strong><p>Contextual actions that operate on selected canvas content, such as edit, annotate, normalize, or remove.</p><code>selectionTools[] → selected IDs</code></div></div>
              </div>
              <h3>Form fields</h3>
              <p>Supported field types are <code>text</code>, <code>number</code>, <code>select</code>, <code>symbol-grid</code>, <code>data-grid</code>, <code>set-builder</code>, <code>set-members</code>, and <code>matrix-grid</code>. Values arrive as strings, including numeric values and serialized grid data. Parse and validate them in the bundle instead of trusting the field type.</p>
              <h3>Good contribution design</h3>
              <ul className="docs-bullet-list">
                <li>Use a short label that tells the user what will happen.</li>
                <li>Use the description to explain the result and any selection requirement.</li>
                <li>Keep tool IDs and command IDs namespaced with the plugin ID.</li>
                <li>Make one command produce one predictable result and fail safely when input is incomplete.</li>
                <li>Keep the manifest contributions and runtime registration exactly in sync.</li>
              </ul>
            </section>

            <section className="docs-section" id="publishing">
              <p className="docs-section-kicker">07 / Publish</p>
              <h2>Draft, review, publish</h2>
              <p>Creating a plugin saves a draft for your account. It does not publish the plugin or make it available to everyone. Publication is an explicit review decision so users can trust that a package has a known contract and release history.</p>
              <div className="docs-status-flow"><span>Draft</span><ChevronRight size={15} /><span>In review</span><ChevronRight size={15} /><span>Approved</span><ChevronRight size={15} /><span>Published</span></div>
              <div className="docs-publish-list">
                <div><strong>Draft</strong><span>You can edit the package details and add versions.</span></div>
                <div><strong>In review</strong><span>The latest version is being checked against its manifest, bundle, declared permissions, and behavior.</span></div>
                <div><strong>Approved</strong><span>The version passed review and is ready to be published.</span></div>
                <div><strong>Published</strong><span>The approved version is placed in the plugin catalogue.</span></div>
                <div><strong>Rejected or suspended</strong><span>Read the review feedback, correct the package from Developer workspace, and submit an appropriate new version or resubmission.</span></div>
              </div>
              <h3>Artifact limits</h3>
              <div className="docs-limit-list">
                <div><strong>Manifest JSON</strong><span>Use valid JSON. The dashboard accepts manifest files under 120 KB.</span></div>
                <div><strong>JavaScript bundle</strong><span>JavaScript or MJS, under 480 KB in the dashboard upload control; server validation caps inline code at 500,000 characters.</span></div>
                <div><strong>ZIP archive</strong><span>ZIP package under 2 MB.</span></div>
                <div><strong>Logo</strong><span>PNG, JPEG, WebP, or SVG under 240 KB in the dashboard.</span></div>
              </div>
            </section>

            <section className="docs-section" id="updates">
              <p className="docs-section-kicker">08 / Update</p>
              <h2>Ship updates from the dashboard</h2>
              <p>Plugin versions are immutable release records. To update a plugin, select it in Developer workspace and add a new version. Do not overwrite the old contract or reuse its version number.</p>
              <ol className="docs-numbered-list docs-dashboard-steps">
                <li><strong>Choose a semantic version.</strong><span>Use a patch version for compatible fixes, a minor version for backwards-compatible features, and a major version for breaking contract changes.</span></li>
                <li><strong>Copy and update the manifest.</strong><span>Keep the same plugin ID, update the manifest version, and add or change only the contributions the release actually implements.</span></li>
                <li><strong>Upload the new bundle.</strong><span>Attach the complete implementation for that version. Keep the old package available as the previous release.</span></li>
                <li><strong>Write a useful changelog.</strong><span>Explain new commands, changed fields, permission changes, compatibility, and anything reviewers need to verify.</span></li>
                <li><strong>Test old output.</strong><span>Existing canvas objects must remain understandable. If the new release changes how generated content is interpreted, include a compatibility plan in the changelog.</span></li>
                <li><strong>Submit the new version.</strong><span>Review and publication apply to the newest version, while the previous version remains part of the release history.</span></li>
              </ol>
              <div className="docs-callout docs-callout-gold"><GitBranch size={18} /><div><strong>Release discipline</strong><p>Never silently change the meaning of an existing command, field, or generated object. A plugin user should be able to understand what changed by reading the version and changelog in the dashboard.</p></div></div>
            </section>

            <section className="docs-section" id="security">
              <p className="docs-section-kicker">09 / Safety</p>
              <h2>Build a package reviewers can trust</h2>
              <div className="docs-safety-grid">
                <article><ShieldCheck size={18} /><strong>Least privilege</strong><p>Declare only the permissions your plugin needs. A permission is a contract with users and reviewers, not a shortcut to extra behavior.</p></article>
                <article><LockKeyhole size={18} /><strong>Validate input</strong><p>Treat every form value and browser message as untrusted. Bound collection sizes, numeric ranges, text length, and expensive calculations.</p></article>
                <article><PackageCheck size={18} /><strong>Keep releases clear</strong><p>Make the manifest, bundle, ZIP, logo, and changelog agree. Review becomes difficult when the package describes one behavior but implements another.</p></article>
              </div>
              <p className="docs-muted-note">The review sandbox is isolated from live rooms. Do not put secrets, access tokens, or private room data in a bundle, manifest, payload, or custom message. A published package should request no more access than its visible feature requires.</p>
            </section>

            <section className="docs-section docs-reference-section" id="checklist">
              <p className="docs-section-kicker">10 / Checklist</p>
              <h2>Before you submit</h2>
              <ul className="docs-check-list">
                <li><CheckCircle2 size={15} /> The plugin ID is unique, lowercase, and the same everywhere.</li>
                <li><CheckCircle2 size={15} /> The manifest version matches the dashboard version.</li>
                <li><CheckCircle2 size={15} /> Every tool and selection tool points to a declared command.</li>
                <li><CheckCircle2 size={15} /> The bundle sends ready, register, and command messages with the correct plugin ID.</li>
                <li><CheckCircle2 size={15} /> All form values and execution payloads are validated.</li>
                <li><CheckCircle2 size={15} /> The package includes a useful description and changelog.</li>
                <li><CheckCircle2 size={15} /> You tested empty input, invalid input, and the normal happy path.</li>
                <li><CheckCircle2 size={15} /> The next version number is new and the previous release remains compatible.</li>
              </ul>
              <Link className="docs-primary-button docs-final-link" href="/dashboard?tab=developer">Return to plugin studio <ArrowUpRight size={15} /></Link>
            </section>
          </article>
        </div>
      </main>
    </div>
  );
}

export default Docs;
