import { useEffect } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Eraser,
  Hand,
  Keyboard,
  LayoutDashboard,
  Link2,
  LockKeyhole,
  MousePointer2,
  PenTool,
  Puzzle,
  Shapes,
  UsersRound,
} from 'lucide-react';
import { Link } from 'wouter';
import '@/styles/Guide.css';

const accessModes = [
  {
    title: 'Private by default',
    description: 'A password is generated for you. Share the room code and password with the people you trust.',
    icon: LockKeyhole,
  },
  {
    title: 'Open room',
    description: 'Anyone with the room code can join. Use this for a low-friction workshop or open session.',
    icon: UsersRound,
  },
  {
    title: 'Ask to join',
    description: 'People can request access, but an owner or instructor must approve them before they enter.',
    icon: CircleAlert,
  },
];

const roles = [
  { name: 'Owner', access: 'Full room control', detail: 'Can draw, manage members, change roles, and close the room.' },
  { name: 'Instructor / Editor', access: 'Can edit', detail: 'Can draw, insert, transform, and collaborate on the shared canvas.' },
  { name: 'Viewer', access: 'Read only', detail: 'Can follow the room and navigate the board without changing its content.' },
];

const plugins = [
  { name: 'Notes', description: 'Create formatted notes with headings, lists, numbers, colors, and document styling.' },
  { name: 'Mathematical Set', description: 'Insert Venn diagrams, graphs, number lines, symbols, set operations, and matrices.' },
  { name: 'Statistics', description: 'Build datasets, calculate summaries, and add charts such as bar charts and box plots.' },
  { name: 'Tag', description: 'Attach a label above or below a selected object so it can be identified.' },
];

const shortcuts = [
  ['Ctrl/Cmd+B', 'Chalk'],
  ['Ctrl/Cmd+E', 'Eraser'],
  ['Ctrl/Cmd+M or H', 'Pan / move the board'],
  ['Ctrl/Cmd+S', 'Select'],
  ['Ctrl/Cmd+I', 'Open Insert'],
  ['Ctrl/Cmd+L', 'Open Links'],
  ['Ctrl/Cmd+O', 'Toggle selection toolbox'],
  ['Ctrl/Cmd+Z', 'Undo'],
  ['Ctrl/Cmd+Shift+Z or Y', 'Redo'],
  ['Ctrl/Cmd+C, X, V, D', 'Copy, cut, paste, duplicate'],
  ['Ctrl/Cmd+G', 'Group selected objects'],
  ['Ctrl/Cmd+Shift+G', 'Ungroup selected objects'],
  ['Ctrl/Cmd+Shift+T', 'Crop selected content'],
  ['Ctrl/Cmd+Alt+Plus/Minus', 'Zoom in or out'],
  ['Esc', 'Deselect or cancel crop'],
];

const guideSections = [
  ['quick-start', '01 / Quick start'],
  ['dashboard', '02 / Dashboard'],
  ['access', '03 / Access and roles'],
  ['canvas', '04 / Canvas controls'],
  ['organize', '05 / Organize the board'],
  ['collaborate', '06 / Collaborate'],
  ['plugins', '07 / Toolkit and plugins'],
  ['shortcuts', '08 / Shortcuts'],
  ['troubleshooting', '09 / Troubleshooting'],
  ['docs-map', '10 / Other documentation'],
];

function Guide() {
  useEffect(() => {
    document.title = 'How to use Chalkboard';
    document.documentElement.classList.add('guide-active');
    document.body.classList.add('guide-active');

    return () => {
      document.documentElement.classList.remove('guide-active');
      document.body.classList.remove('guide-active');
    };
  }, []);

  return (
    <div className="guide-page">
      <header className="guide-header">
        <Link className="guide-brand" href="/" aria-label="Chalkboard home">
          <span className="guide-brand-mark">C</span>
          <span>Chalkboard</span>
        </Link>
        <div className="guide-header-actions">
          <span className="guide-header-label"><BookOpen size={14} /> User guide</span>
          <Link className="guide-header-link" href="/docs"><ArrowUpRight size={14} /> Developer docs</Link>
          <Link className="guide-header-link" href="/"><ArrowLeft size={14} /> Home</Link>
        </div>
      </header>

      <main className="guide-main">
        <section className="guide-hero" aria-labelledby="guide-title">
          <div className="guide-hero-copy">
            <p className="guide-eyebrow"><span /> A practical walkthrough</p>
            <h1 id="guide-title">Find your way around, then make the idea <em>visible.</em></h1>
            <p className="guide-lede">Chalkboard is a shared canvas for sketching, teaching, planning, and thinking together. This guide takes you from your first room to the tools you will use every day.</p>
            <div className="guide-hero-actions">
              <Link className="guide-primary-button" href="/dashboard?tab=rooms">Open your first room <ArrowUpRight size={15} /></Link>
              <a className="guide-secondary-button" href="#quick-start">Start the walkthrough <ChevronRight size={15} /></a>
            </div>
          </div>
          <div className="guide-hero-index" aria-label="Guide overview">
            <div><span>First move</span><strong>Open a room</strong><small>Give the idea somewhere to go</small></div>
            <div><span>Shared work</span><strong>Draw together</strong><small>See the board and people update live</small></div>
            <div><span>Next move</span><strong>Add structure</strong><small>Use shapes, notes, links, and plugins</small></div>
          </div>
        </section>

        <section className="guide-snapshot-strip" aria-labelledby="guide-snapshot-title">
          <div className="guide-snapshot-copy">
            <p className="guide-section-kicker">A visual orientation</p>
            <h2 id="guide-snapshot-title">The room is the medium.</h2>
            <p>The homepage preview gives you a quick feel for the product rhythm. The existing developer documentation is separate from this user walkthrough and is where plugin authoring lives.</p>
          </div>
          <div className="guide-snapshot-grid">
            <figure className="guide-snapshot-card guide-snapshot-card-wide">
              <div className="guide-snapshot-pair">
                <img src="/guide/home-live.png" alt="Live snapshot of the Chalkboard homepage in light mode, including its collaborative room preview" />
                <img src="/guide/home-dark-live.png" alt="Live snapshot of the Chalkboard homepage in dark mode, including its collaborative room preview" />
              </div>
              <figcaption><span>01</span> Homepage and shared-room preview in both themes</figcaption>
            </figure>
            <figure className="guide-snapshot-card">
              <img src="/guide/developer-docs-live.png" alt="Live snapshot of Chalkboard's developer and plugin documentation page" />
              <figcaption><span>02</span> Existing developer/plugin docs</figcaption>
            </figure>
          </div>
        </section>

        <div className="guide-layout">
          <aside className="guide-sidebar">
            <p className="guide-sidebar-label">On this page</p>
            <nav aria-label="User guide sections">
              {guideSections.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}
            </nav>
          </aside>

          <article className="guide-article">
            <section className="guide-section guide-section-first" id="quick-start">
              <p className="guide-section-kicker">01 / Quick start</p>
              <h2>Your first session, from blank page to shared work.</h2>
              <p>If you are new to Chalkboard, follow this sequence once. It gives you the working model for everything else in the guide.</p>
              <ol className="guide-numbered-list">
                <li><strong>Sign in.</strong><span>Chalkboard uses your Google account to identify you in rooms and keep your workspace private.</span></li>
                <li><strong>Create or join a room.</strong><span>From Dashboard → Rooms, create a room or enter a room code. If a room is private, enter the password shared by its owner.</span></li>
                <li><strong>Choose a simple first action.</strong><span>Select Chalk, make a mark, then switch to Select and move it. The board is shared, so collaborators see the same change.</span></li>
                <li><strong>Add structure.</strong><span>Open Insert to add a shape, saved link, note, math object, chart, or tag.</span></li>
                <li><strong>Leave with intent.</strong><span>Use room details to see who is present, copy the invite, or exit back to your dashboard.</span></li>
              </ol>
              <div className="guide-callout guide-callout-gold"><CheckCircle2 size={18} /><div><strong>The important idea</strong><p>A Chalkboard room is not just a drawing surface. It keeps the sketch, explanation, context, and next step in one shared place.</p></div></div>
            </section>

            <section className="guide-section" id="dashboard">
              <p className="guide-section-kicker">02 / Dashboard</p>
              <h2>Start from the workspace, not from the canvas.</h2>
              <p>The dashboard is where you find rooms, discover the built-in toolkit, manage your profile, and—when enabled—open the Developer workspace.</p>
              <div className="guide-feature-grid">
                <article><span className="guide-card-icon"><LayoutDashboard size={18} /></span><strong>Overview</strong><p>See your recent rooms and the simple Chalkboard rhythm: open a room, make thinking visible, and move together.</p></article>
                <article><span className="guide-card-icon"><Shapes size={18} /></span><strong>Rooms</strong><p>Create a room, join an existing room, copy invites, inspect members, reset a private-room password, or delete a room you own.</p></article>
                <article><span className="guide-card-icon"><Puzzle size={18} /></span><strong>Toolkit</strong><p>Get a quick explanation of freehand canvas, shapes, notes, links, and thinking plugins before entering a room.</p></article>
                <article><span className="guide-card-icon"><UsersRound size={18} /></span><strong>Profile</strong><p>Review the account that identifies you in a room. Developer mode is also enabled from Profile when you need to author plugins.</p></article>
              </div>
              <h3>Creating a room</h3>
              <ol className="guide-numbered-list guide-numbered-list-compact">
                <li><strong>Name the room.</strong><span>Use a clear title such as “Monday geometry” or “Product ideas”. The description is useful context for people joining later.</span></li>
                <li><strong>Choose access.</strong><span>Pick private/password, open, or ask-to-join access before you create the room.</span></li>
                <li><strong>Choose the default role and theme.</strong><span>Make new members editors or viewers, then choose from Classroom, Workshop, Brainstorm, Meeting, Planning, or Studio.</span></li>
                <li><strong>Save the invitation.</strong><span>For a private room, copy both the room code and generated password when the creation confirmation appears.</span></li>
              </ol>
            </section>

            <section className="guide-section" id="access">
              <p className="guide-section-kicker">03 / Access and roles</p>
              <h2>Know who can enter and who can change the board.</h2>
              <div className="guide-definition-grid">
                {accessModes.map(({ title, description, icon: Icon }) => <article key={title}><span className="guide-card-icon"><Icon size={18} /></span><strong>{title}</strong><p>{description}</p></article>)}
              </div>
              <div className="guide-table-wrap">
                <table className="guide-table">
                  <thead><tr><th>Role</th><th>Access</th><th>What it means</th></tr></thead>
                  <tbody>{roles.map((role) => <tr key={role.name}><td>{role.name}</td><td>{role.access}</td><td>{role.detail}</td></tr>)}</tbody>
                </table>
              </div>
              <div className="guide-callout guide-callout-dark"><CircleAlert size={18} /><div><strong>Viewer mode is intentional</strong><p>If you see “Viewer · read only”, the room is working normally. Ask the owner or instructor to change your role if you need to edit.</p></div></div>
            </section>

            <section className="guide-section" id="canvas">
              <p className="guide-section-kicker">04 / Canvas controls</p>
              <h2>Four tools cover the basic movement of the board.</h2>
              <div className="guide-tool-grid">
                <article><span className="guide-tool-icon"><PenTool size={19} /></span><strong>Chalk</strong><p>Draw freehand marks. Open its settings to change color, brush size, and intensity.</p><code>Ctrl/Cmd+B</code></article>
                <article><span className="guide-tool-icon"><Eraser size={19} /></span><strong>Eraser</strong><p>Remove marks with an adjustable width and height. Use it when you want to edit directly on the canvas.</p><code>Ctrl/Cmd+E</code></article>
                <article><span className="guide-tool-icon"><Hand size={19} /></span><strong>Pan</strong><p>Move around the open canvas without changing its content. You can also use the arrow keys.</p><code>Ctrl/Cmd+M or H</code></article>
                <article><span className="guide-tool-icon"><MousePointer2 size={19} /></span><strong>Select</strong><p>Select one or more strokes or objects to move, transform, copy, group, crop, or delete them.</p><code>Ctrl/Cmd+S</code></article>
              </div>
              <h3>Board navigation</h3>
              <div className="guide-reference-list">
                <div><strong>Zoom</strong><span>Use the minus and plus controls in the lower-right corner, then use reset to return to the default view.</span></div>
                <div><strong>Fullscreen</strong><span>Use the fullscreen control in the room header when you want the canvas to take over the window.</span></div>
                <div><strong>Undo and redo</strong><span>The center action controls apply to shared board history. Use Clear only when you intend to remove the entire board for everyone.</span></div>
              </div>
            </section>

            <section className="guide-section" id="organize">
              <p className="guide-section-kicker">05 / Organize the board</p>
              <h2>Turn marks into something people can follow.</h2>
              <p>Select an object to reveal the selection toolbox. Some controls open a small side panel; hover or move across the row to reveal it.</p>
              <div className="guide-action-grid">
                <div><strong>Color and size</strong><span>Change the stroke color, fill color, or stroke size of selected content.</span></div>
                <div><strong>Dimensions and rotation</strong><span>Set width and height, rotate in 90° steps, or reset rotation.</span></div>
                <div><strong>Copy and transform</strong><span>Copy, cut, duplicate, group, ungroup, and crop selected objects.</span></div>
                <div><strong>Delete and deselect</strong><span>Delete only the selection, or press Esc to clear the selection without changing the board.</span></div>
              </div>
              <h3>Insert menu</h3>
              <div className="guide-insert-grid">
                <article><span className="guide-card-icon"><Shapes size={18} /></span><strong>Shapes</strong><p>Choose rectangles, squares, circles, polygons, stars, diamonds, crosses, hearts, lines, or arrows.</p></article>
                <article><span className="guide-card-icon"><Link2 size={18} /></span><strong>Links</strong><p>Create a named link from the current selection, then return to that location later. Links can be renamed or removed.</p></article>
                <article><span className="guide-card-icon"><Puzzle size={18} /></span><strong>Plugins</strong><p>Open a built-in or published plugin and run a focused tool without leaving the room.</p></article>
              </div>
            </section>

            <section className="guide-section" id="collaborate">
              <p className="guide-section-kicker">06 / Collaborate</p>
              <h2>Make the shared room feel shared.</h2>
              <div className="guide-numbered-list guide-collaboration-list">
                <div><span>01</span><div><strong>Watch the presence count.</strong><p>The people control in the room header shows how many collaborators are online. Open it to see room information and members.</p></div></div>
                <div><span>02</span><div><strong>Follow live cursors.</strong><p>Editors appear with named cursors as they work. This makes it easier to coordinate attention without interrupting the canvas.</p></div></div>
                <div><span>03</span><div><strong>Manage access from room details.</strong><p>Owners and instructors can review join requests in approval-required rooms, change member roles, remove members, and copy the invite.</p></div></div>
                <div><span>04</span><div><strong>Exit cleanly.</strong><p>Use Exit to return to the dashboard. Owners can close a room when the work is finished; a closed room cannot be reopened.</p></div></div>
              </div>
              <div className="guide-callout guide-callout-gold"><CheckCircle2 size={18} /><div><strong>A useful room habit</strong><p>Use a shape or saved link to mark the current topic, then leave a note with the next action. The board becomes easier to revisit after the live session.</p></div></div>
            </section>

            <section className="guide-section" id="plugins">
              <p className="guide-section-kicker">07 / Toolkit and plugins</p>
              <h2>Use the right tool for the kind of thinking you are doing.</h2>
              <p>Open Insert → Plugins inside a room. Some tools create new content; others appear when you have selected something on the board.</p>
              <div className="guide-plugin-grid">
                {plugins.map((plugin) => <article key={plugin.name}><span className="guide-plugin-number">{String(plugins.indexOf(plugin) + 1).padStart(2, '0')}</span><strong>{plugin.name}</strong><p>{plugin.description}</p></article>)}
              </div>
              <h3>Developer workspace</h3>
              <p>When Developer mode is enabled from Profile, the dashboard exposes the Developer workspace and the existing plugin documentation. That area is for creating, testing, reviewing, and publishing plugin packages; it is not required for normal room use.</p>
              <Link className="guide-inline-link" href="/docs">Read the plugin developer guide <ArrowUpRight size={14} /></Link>
            </section>

            <section className="guide-section" id="shortcuts">
              <p className="guide-section-kicker">08 / Shortcuts</p>
              <h2>Keep this reference nearby once the basics feel familiar.</h2>
              <div className="guide-shortcuts-grid">
                {shortcuts.map(([shortcut, action]) => <div key={shortcut}><kbd>{shortcut}</kbd><span>{action}</span></div>)}
              </div>
              <p className="guide-muted-note"><Keyboard size={15} /> On macOS, use Command where this table says Ctrl. Shortcuts pause automatically while you are typing in a text field or note editor.</p>
            </section>

            <section className="guide-section" id="troubleshooting">
              <p className="guide-section-kicker">09 / Troubleshooting</p>
              <h2>When something feels unclear, start here.</h2>
              <div className="guide-troubleshooting-grid">
                <article><strong>I cannot join.</strong><p>Check the room code, then confirm whether the room requires a password or owner approval.</p></article>
                <article><strong>I can see the board but cannot edit.</strong><p>You are probably a viewer. Ask an owner or instructor to change your role.</p></article>
                <article><strong>The board is off-screen.</strong><p>Use Pan, zoom out, or press the reset pan/zoom control in the lower-right corner.</p></article>
                <article><strong>I changed the wrong thing.</strong><p>Use Undo immediately. For selected content, press Esc to deselect before continuing.</p></article>
                <article><strong>A plugin is not available.</strong><p>Open Insert → Plugins and search by name. Published plugins may be unavailable until they have been approved and published.</p></article>
                <article><strong>The room is closed.</strong><p>Closed rooms cannot be reopened. Create a new room and share its new invitation.</p></article>
              </div>
            </section>

            <section className="guide-section guide-final-section" id="docs-map">
              <p className="guide-section-kicker">10 / Other documentation</p>
              <h2>Use the right guide for the job.</h2>
              <div className="guide-docs-map">
                <article><span className="guide-card-icon"><BookOpen size={18} /></span><strong>You are here: User guide</strong><p>How to sign in, create or join rooms, use the canvas, collaborate, and recover from common mistakes.</p></article>
                <article><span className="guide-card-icon"><Puzzle size={18} /></span><strong><Link href="/docs">Plugin developer guide</Link></strong><p>How to package, test, submit, review, publish, and update Chalkboard plugins.</p></article>
                <article><span className="guide-card-icon"><LayoutDashboard size={18} /></span><strong>Project contributor docs</strong><p>Repository setup, frontend/backend architecture, database, Redis, realtime behavior, and deployment remain in the repository README files.</p></article>
              </div>
              <div className="guide-callout guide-callout-dark"><CircleAlert size={18} /><div><strong>Keep the product guide honest</strong><p>This walkthrough documents controls currently exposed in the interface. Capabilities that exist only in backend services or future plans should not be presented as available user actions.</p></div></div>
              <Link className="guide-primary-button guide-final-button" href="/dashboard?tab=rooms">Go make something visible <ArrowUpRight size={15} /></Link>
            </section>
          </article>
        </div>
      </main>
    </div>
  );
}

export default Guide;
