/**
 * Chalkboard pitch deck generator.
 *
 * Builds chalkboard-pitch-deck.pptx from the dashboard design system
 * (PublicPages.css): chalk-black background, warm hairline-bordered panels,
 * Georgia serif display with italic gold emphasis, uppercase letter-spaced
 * kickers with a gold dot, numbered rows, and orbit hero art.
 *
 * Run: npm install && npm run generate
 */
import pptxgen from 'pptxgenjs';

/* ---------------------------------------------------------------------------
 * Design tokens (mirror of the dashboard CSS custom properties)
 * ------------------------------------------------------------------------- */
const C = {
  bg: '090909',          // --dashboard-black
  panel: '111110',       // --dashboard-black-soft
  ink: 'F5F2EA',         // --dashboard-white
  muted: 'A6A29A',       // --dashboard-muted
  dim: '77736C',         // rail labels / secondary copy
  gold: 'C7A258',        // --dashboard-gold
  goldBright: 'E3C77E',  // --dashboard-gold-bright
  line: '2A2A29',        // rgba(245,242,234,0.14) over #090909
  goldLine: '8F7541',    // rgba(199,162,88,0.7) over #090909
  cardWhite: 'FFFDF7',
  cardInk: '191816',
  onGold: '191509',
};

const FONT_SERIF = 'Georgia';
const FONT_SANS = 'Arial';
const FONT_MONO = 'Consolas';

const PAGE = { w: 13.333, h: 7.5 };
const M = 0.55; // page margin
const TOTAL_SLIDES = 11;

const pptx = new pptxgen();
pptx.defineLayout({ name: 'WIDE', width: PAGE.w, height: PAGE.h });
pptx.layout = 'WIDE';
pptx.author = 'Chalkboard';
pptx.title = 'Chalkboard — A live canvas for shared thinking';
pptx.subject = 'Product pitch deck';

/* ---------------------------------------------------------------------------
 * Small building blocks
 * ------------------------------------------------------------------------- */

function slide() {
  const s = pptx.addSlide();
  s.background = { color: C.bg };
  return s;
}

function kicker(s, x, y, text, color = C.goldBright) {
  s.addShape('rect', { x, y: y + 0.05, w: 0.09, h: 0.09, fill: { color: C.gold }, line: { color: C.gold, width: 1 } });
  s.addText(text, {
    x: x + 0.2, y, w: 9.5, h: 0.2,
    fontFace: FONT_SANS, fontSize: 9, bold: true, charSpacing: 1.5,
    color, align: 'left', valign: 'middle',
  });
}

function title(s, runs, x = M, y = 0.82, w = PAGE.w - M * 2, size = 38) {
  const normalized = typeof runs === 'string'
    ? [{ text: runs, options: {} }]
    : runs;
  s.addText(normalized, {
    x, y, w, h: 1.35,
    fontFace: FONT_SERIF, fontSize: size, color: C.ink,
    align: 'left', valign: 'top', lineSpacingMultiple: 1.02, shrinkText: true,
  });
}

function body(s, text, x = M, y = 2.28, w = PAGE.w - M * 2, opts = {}) {
  s.addText(text, {
    x, y, w, h: opts.h ?? 0.7,
    fontFace: FONT_SANS, fontSize: 12, color: C.muted,
    align: 'left', valign: 'top', lineSpacingMultiple: 1.42,
    ...opts,
  });
}

function panel(s, x, y, w, h, opts = {}) {
  s.addShape('roundRect', {
    x, y, w, h, rectRadius: 0.06,
    fill: { color: opts.fill ?? C.panel, transparency: opts.fillTransparency ?? 0 },
    line: { color: opts.line ?? C.line, width: 0.75 },
  });
}

function footer(s, index) {
  const n = String(index).padStart(2, '0');
  s.addText(`CHALKBOARD — PITCH DECK`, {
    x: M, y: 7.08, w: 4, h: 0.22,
    fontFace: FONT_MONO, fontSize: 7, charSpacing: 1.2, color: C.dim,
  });
  s.addText(`${n} / ${TOTAL_SLIDES}`, {
    x: PAGE.w - M - 1.2, y: 7.08, w: 1.2, h: 0.22,
    fontFace: FONT_MONO, fontSize: 7, charSpacing: 1.2, color: C.dim, align: 'right',
  });
}

function ctaButton(s, x, y, w, label, opts = {}) {
  const solid = opts.solid ?? true;
  s.addText(label, {
    x, y, w, h: 0.5,
    shape: pptx.ShapeType.roundRect, rectRadius: 0.05,
    fill: solid ? { color: C.gold } : { color: C.panel },
    line: solid ? { color: C.gold, width: 1 } : { color: C.line, width: 1 },
    fontFace: FONT_SANS, fontSize: 8.5, bold: true, charSpacing: 1.5,
    color: solid ? C.onGold : C.goldBright,
    align: 'center', valign: 'middle',
  });
}

/* Numbered feature rows used by the "rhythm" lists: gold index, bold label,
 * muted trailing description, hairline separator between rows. */
function numberedRows(s, x, y, w, rows, rowH = 0.62, opts = {}) {
  rows.forEach((row, i) => {
    const ry = y + i * rowH;
    const strong = row.strong ?? '';
    const rest = row.rest ?? '';
    s.addText(String(i + 1).padStart(2, '0'), {
      x, y: ry, w: 0.5, h: rowH,
      fontFace: FONT_MONO, fontSize: 10, color: C.gold, align: 'left', valign: 'top',
    });
    const runs = [];
    if (strong) runs.push({ text: strong, options: { bold: true, color: C.ink } });
    if (strong && rest) runs.push({ text: `  —  `, options: { color: C.dim } });
    if (rest) runs.push({ text: rest, options: { color: C.muted } });
    s.addText(runs, {
      x: x + 0.55, y: ry, w: w - 0.55, h: rowH,
      fontFace: FONT_SANS, fontSize: 11, align: 'left', valign: 'top', lineSpacingMultiple: 1.25,
    });
    if (i < rows.length - 1) {
      s.addShape('rect', { x, y: ry + rowH - 0.015, w, h: 0.015, fill: { color: C.line }, line: { color: C.line, width: 0.1 } });
    }
  });
}

/* Checklist rows: gold dot marker, bold label, muted detail. */
function checkRows(s, x, y, w, rows, rowH = 0.56) {
  rows.forEach((row, i) => {
    const ry = y + i * rowH;
    s.addShape('rect', { x, y: ry + 0.11, w: 0.085, h: 0.085, fill: { color: C.gold }, line: { color: C.gold, width: 1 } });
    const runs = [];
    if (row.strong) runs.push({ text: row.strong, options: { bold: true, color: C.ink } });
    if (row.strong && row.rest) runs.push({ text: `  —  `, options: { color: C.dim } });
    if (row.rest) runs.push({ text: row.rest, options: { color: C.muted } });
    s.addText(runs, {
      x: x + 0.28, y: ry, w: w - 0.28, h: rowH,
      fontFace: FONT_SANS, fontSize: 10.5, align: 'left', valign: 'top', lineSpacingMultiple: 1.22,
    });
  });
}

function panelKicker(s, x, y, text) {
  s.addText(text, {
    x, y, w: 8, h: 0.2,
    fontFace: FONT_SANS, fontSize: 8, bold: true, charSpacing: 1.5,
    color: C.goldBright, align: 'left', valign: 'middle',
  });
}

function orbit(s, x, y, w, h, rotate, color = C.line, width = 1) {
  s.addShape('ellipse', { x, y, w, h, rotate, fill: { color: C.bg, transparency: 100 }, line: { color, width } });
}

function artCard(s, x, y, w, num, label, small, opts = {}) {
  const fill = opts.white ? C.cardWhite : C.goldBright;
  const ink = opts.white ? C.cardInk : C.onGold;
  s.addShape('roundRect', { x, y, w, h: 0.66, rectRadius: 0.07, rotate: opts.rotate ?? 0, fill: { color: fill }, line: { color: fill, width: 1 } });
  const labelColor = opts.white ? C.cardInk : C.onGold;
  const smallColor = opts.white ? '6D685F' : '7A6A3C';
  s.addText(
    [
      { text: `${num}  `, options: { fontFace: FONT_MONO, fontSize: 8, bold: true, charSpacing: 1.2, color: smallColor } },
      { text: label, options: { fontFace: FONT_SANS, fontSize: 9, bold: true, charSpacing: 1.1, color: labelColor } },
      { text: `\n${small}`, options: { fontFace: FONT_SANS, fontSize: 7.5, color: smallColor, breakLine: true } },
    ],
    { x: x + 0.14, y: y + 0.1, w: w - 0.28, h: 0.5, align: 'left', valign: 'middle', lineSpacingMultiple: 1.1 },
  );
}

/* Chalk-like stroke decoration: thin rotated rectangle. */
function chalkStroke(s, x, y, w, color, rotate, transparency = 0) {
  s.addShape('rect', { x, y, w, h: 0.045, rotate, fill: { color, transparency }, line: { color, transparency, width: 0.1 } });
}

/* ---------------------------------------------------------------------------
 * 01 — Cover
 * ------------------------------------------------------------------------- */
function slideCover() {
  const s = slide();

  orbit(s, 8.5, 0.85, 3.3, 2.05, -17, C.line, 1.25);
  orbit(s, 8.85, 2.9, 3.9, 4.85, 28, C.goldLine, 1.25);
  orbit(s, 7.0, 4.45, 1.7, 0.95, 12, C.line, 1);

  artCard(s, 8.7, 1.75, 2.05, '01', 'FIND THE SIGNAL', 'everyone can build on', { rotate: -4 });
  artCard(s, 10.7, 3.7, 2.05, '02', 'MAKE IT SHARED', 'then move together', { rotate: 4, white: true });

  chalkStroke(s, 8.2, 5.45, 2.3, 'F5F2EA', -6, 88);
  chalkStroke(s, 8.75, 5.75, 1.55, C.goldBright, 4, 70);
  chalkStroke(s, 9.55, 5.35, 1.05, C.gold, 42, 78);

  kicker(s, M, 0.62, 'CHALKBOARD / THE PRODUCT');
  s.addText(
    [
      { text: 'A live canvas for\n', options: { breakLine: true } },
      { text: 'shared thinking.', options: { italic: true, color: C.goldBright } },
    ],
    {
      x: M, y: 1.5, w: 8.3, h: 2.3,
      fontFace: FONT_SERIF, fontSize: 52, color: C.ink,
      align: 'left', valign: 'top', lineSpacingMultiple: 1.0,
    },
  );
  s.addText(
    'Chalkboard is a real-time collaborative room where a team, a class, or a study group draws, explains, and sees one another\'s work as it happens — with one shared, persistent canvas to build on.',
    {
      x: M, y: 3.95, w: 6.7, h: 0.95,
      fontFace: FONT_SANS, fontSize: 12.5, color: C.muted,
      align: 'left', valign: 'top', lineSpacingMultiple: 1.42,
    },
  );

  ctaButton(s, M, 5.15, 2.9, 'BETA LIVE — CHALKBOARD.CLICK');
  ctaButton(s, 3.6, 5.15, 2.9, 'EXTENSIBLE PLUGIN PLATFORM', { solid: false });

  footer(s, 1);
  s.addNotes('Chalkboard: one shared, persistent canvas for thinking together. Beta is live at chalkboard.click.');
}

/* ---------------------------------------------------------------------------
 * 02 — Problem
 * ------------------------------------------------------------------------- */
function slideProblem() {
  const s = slide();
  kicker(s, M, 0.5, 'THE PROBLEM / 01');
  title(s, [
    { text: 'Good thinking gets ', options: {} },
    { text: 'scattered', options: { italic: true, color: C.goldBright } },
    { text: ' across disconnected tools.', options: {} },
  ]);
  body(s, 'Conversation happens in the video call, diagrams in a whiteboard app, notes in a document, links in chat. When the meeting ends, the thinking has no shared home.');

  panel(s, M, 3.05, 7.6, 3.45);
  panelKicker(s, 0.73, 3.28, 'THE USUAL ROOM / FOUR FRAGMENTS');
  numberedRows(s, 0.75, 3.72, 7.25, [
    { strong: 'Video call', rest: 'the conversation' },
    { strong: 'Whiteboard', rest: 'the diagrams' },
    { strong: 'Document', rest: 'the notes' },
    { strong: 'Chat', rest: 'the links' },
  ], 0.66);

  panel(s, 8.4, 3.05, 4.38, 3.45);
  panelKicker(s, 8.58, 3.28, 'THE COST / AFTER THE MEETING');
  s.addText([
    { text: 'Where did we ', options: {} },
    { text: 'put that?', options: { italic: true, color: C.goldBright } },
  ], {
    x: 8.58, y: 3.6, w: 4.05, h: 0.6,
    fontFace: FONT_SERIF, fontSize: 23, color: C.ink, align: 'left', valign: 'top',
  });
  s.addText('Everyone leaves with a different version of what was decided — and of where the source of truth lives.', {
    x: 8.58, y: 4.35, w: 4.05, h: 0.75,
    fontFace: FONT_SANS, fontSize: 10.5, color: C.muted, align: 'left', valign: 'top', lineSpacingMultiple: 1.35,
  });
  s.addShape('rect', { x: 8.58, y: 5.25, w: 4.02, h: 0.015, fill: { color: C.line }, line: { color: C.line, width: 0.1 } });
  s.addText([
    { text: '3–4', options: { fontFace: FONT_SERIF, fontSize: 34, color: C.goldBright } },
    { text: '  tools per session\n', options: { fontFace: FONT_SANS, fontSize: 10, color: C.dim, breakLine: true } },
    { text: '0', options: { fontFace: FONT_SERIF, fontSize: 34, color: C.goldBright } },
    { text: '  shared home for the idea afterward', options: { fontFace: FONT_SANS, fontSize: 10, color: C.dim } },
  ], { x: 8.58, y: 5.42, w: 4.02, h: 0.9, align: 'left', valign: 'top' });

  footer(s, 2);
  s.addNotes('Ideas live across video, whiteboard, docs, and chat. Nothing keeps discussion, visual thinking, and next steps in one place.');
}

/* ---------------------------------------------------------------------------
 * 03 — Solution
 * ------------------------------------------------------------------------- */
function slideSolution() {
  const s = slide();
  kicker(s, M, 0.5, 'THE PRODUCT / 02');
  title(s, [
    { text: 'One room where the ', options: {} },
    { text: 'whole idea', options: { italic: true, color: C.goldBright } },
    { text: ' lives.', options: {} },
  ]);
  body(s, 'Chalkboard gives a team, classroom, workshop, or study group one shared, persistent canvas. Everyone draws on the same board, sees one another live, and leaves with the thinking still in place.');

  panel(s, M, 3.05, 7.6, 3.45);
  panelKicker(s, 0.73, 3.28, 'THE ROOM / WHAT IT GIVES YOU');
  checkRows(s, 0.78, 3.7, 7.15, [
    { strong: 'Draw together', rest: 'annotate the same canvas at the same time' },
    { strong: 'See everyone', rest: 'presence, live cursors, names, reactions' },
    { strong: 'Reopen anytime', rest: 'room history reloads for every participant' },
    { strong: 'Control access', rest: 'open, ask-to-join, or password rooms' },
    { strong: 'Extend the board', rest: 'built-in tools and reviewed community plugins' },
  ], 0.555);

  panel(s, 8.4, 3.05, 4.38, 3.45);
  panelKicker(s, 8.58, 3.28, 'A SIMPLE RHYTHM');
  numberedRows(s, 8.58, 3.72, 4.05, [
    { strong: 'Open a room', rest: 'give the idea somewhere to go.' },
    { strong: 'Make it visible', rest: 'draw the thread and add context.' },
    { strong: 'Move together', rest: 'leave with a clear next step.' },
  ], 0.78);

  footer(s, 3);
  s.addNotes('One shared, persistent room replaces the fragmented tool chain: draw, explain, react, and leave with the work intact.');
}

/* ---------------------------------------------------------------------------
 * 04 — Collaborative canvas
 * ------------------------------------------------------------------------- */
function slideCanvas() {
  const s = slide();
  kicker(s, M, 0.5, 'THE CANVAS / 03');
  title(s, [
    { text: 'Tools that keep the ', options: {} },
    { text: 'thought moving.', options: { italic: true, color: C.goldBright } },
  ]);
  body(s, 'Freehand chalk with color, size, intensity, and texture — and rigorous editing on top. Every board mutation is synchronized to the room, so collaborators share one result instead of isolated copies.', { h: 0.85 });

  const cards = [
    { num: '01', label: 'Freehand chalk', desc: 'Color, size, intensity, and chalk-dust styling for loose, natural strokes.' },
    { num: '02', label: 'Shapes & systems', desc: 'Lines, arrows, circles, rectangles, polygons, stars, hearts, crosses, diamonds.' },
    { num: '03', label: 'Notes & links', desc: 'Editable notes and saved links that connect a reference to a spot on the canvas.' },
    { num: '04', label: 'Select & transform', desc: 'Move, resize, rotate, group, duplicate, trim, cut, copy, paste — plus undo, redo, clear.' },
  ];
  const cardW = 5.95;
  const cardH = 1.7;
  const gapX = 0.33;
  const xs = [M, M + cardW + gapX];
  const ys = [3.15, 3.15 + cardH + 0.26];
  cards.forEach((card, i) => {
    const x = xs[i % 2];
    const y = ys[Math.floor(i / 2)];
    panel(s, x, y, cardW, cardH);
    s.addText(card.num, { x: x + 0.3, y: y + 0.24, w: 0.6, h: 0.3, fontFace: FONT_MONO, fontSize: 10, color: C.gold });
    s.addText(card.label, { x: x + 0.3, y: y + 0.58, w: cardW - 0.6, h: 0.4, fontFace: FONT_SERIF, fontSize: 19, color: C.ink });
    s.addText(card.desc, { x: x + 0.3, y: y + 1.05, w: cardW - 0.62, h: 0.55, fontFace: FONT_SANS, fontSize: 10, color: C.muted, lineSpacingMultiple: 1.3 });
  });

  footer(s, 4);
  s.addNotes('The canvas pairs loose chalk drawing with rigorous editing: selection, transforms, grouping, and synchronized undo/redo.');
}

/* ---------------------------------------------------------------------------
 * 05 — Live rooms
 * ------------------------------------------------------------------------- */
function slideRooms() {
  const s = slide();
  kicker(s, M, 0.5, 'THE ROOM / 04');
  title(s, [
    { text: "See ", options: {} },
    { text: "everyone's thinking", options: { italic: true, color: C.goldBright } },
    { text: ' as it happens.', options: {} },
  ]);
  body(s, 'Presence, live cursors, reactions, and raised hands keep the room in sync even when the ideas are not.');

  panel(s, M, 3.05, 7.6, 3.45);
  panelKicker(s, 0.73, 3.28, 'INSIDE THE ROOM / LIVE');
  checkRows(s, 0.78, 3.7, 7.15, [
    { strong: 'Live cursors', rest: 'names and colors, moving in real time' },
    { strong: 'Presence', rest: 'who is here, where, and who is editing' },
    { strong: 'Reactions & hands', rest: 'lightweight feedback, raised hands, counts' },
    { strong: 'Voice rooms', rest: 'scoped LiveKit audio for enabled rooms' },
    { strong: 'Roles', rest: 'owners, instructors, and viewers act in the right scope' },
    { strong: 'Reconnection', rest: 'presence grace period — no flicker on transient drops' },
  ], 0.47);

  panel(s, 8.4, 3.05, 4.38, 3.45);
  panelKicker(s, 8.58, 3.28, 'HOW A ROOM OPENS / ACCESS MODES');
  numberedRows(s, 8.58, 3.72, 4.05, [
    { strong: 'Open rooms', rest: 'anyone with the code joins instantly.' },
    { strong: 'Ask to join', rest: 'the owner reviews each request.' },
    { strong: 'Password', rest: 'a generated password keeps it private.' },
  ], 0.66);
  s.addText('Six room themes — classroom, workshop, brainstorm, meeting, planning, studio.', {
    x: 8.58, y: 5.85, w: 4.05, h: 0.5,
    fontFace: FONT_SANS, fontSize: 9.5, color: C.dim, align: 'left', valign: 'top', lineSpacingMultiple: 1.3,
  });

  const stats = [['LIVE', 'cursors & presence'], ['SYNCED', 'strokes & every board edit'], ['SAVED', 'history reloads on join']];
  const statW = 3.9;
  stats.forEach(([v, l], i) => {
    const x = M + i * (statW + 0.27);
    s.addText(v, { x, y: 6.62, w: statW, h: 0.3, fontFace: FONT_SERIF, fontSize: 15, color: C.goldBright });
    s.addText(l, { x, y: 6.9, w: statW, h: 0.18, fontFace: FONT_MONO, fontSize: 7, charSpacing: 1.2, color: C.dim });
  });

  footer(s, 5);
  s.addNotes('Live cursors, presence, reactions, raised hands, voice, roles, and reconnection grace keep the room alive together.');
}

/* ---------------------------------------------------------------------------
 * 06 — Access & trust
 * ------------------------------------------------------------------------- */
function slideAccess() {
  const s = slide();
  kicker(s, M, 0.5, 'ACCESS / 05');
  title(s, [
    { text: 'Private by default, ', options: {} },
    { text: 'safe by design.', options: { italic: true, color: C.goldBright } },
  ]);
  body(s, 'Rooms start private. Authentication, roles, rate limits, and a guarded admin console do the housekeeping so the canvas stays open.');

  panel(s, M, 3.05, 7.6, 3.45);
  panelKicker(s, 0.73, 3.28, 'AUTHENTICATION & CONTROL');
  checkRows(s, 0.78, 3.7, 7.15, [
    { strong: 'Google sign-in', rest: 'credential verified server-side, HTTP-only session cookie' },
    { strong: 'Room roles', rest: 'owner, instructor, viewer — capabilities match the role' },
    { strong: 'Platform roles', rest: 'user, admin, super_admin for the wider system' },
    { strong: 'Admin console', rest: 'separate TOTP two-factor session' },
    { strong: 'Guards', rest: 'payload validation and rate limits on invites, reactions, hands' },
    { strong: 'Lifecycle', rest: 'inactive rooms archive after 24 hours by default' },
  ], 0.47);

  panel(s, 8.4, 3.05, 4.38, 3.45);
  panelKicker(s, 8.58, 3.28, 'BY THE NUMBERS');
  const nums = [
    ['24h', 'inactivity archive', 'stale rooms close with their state cleaned up'],
    ['2FA', 'admin protection', 'TOTP codes and recovery codes, separate session'],
    ['3', 'access modes', 'open, ask-to-join, password-protected'],
  ];
  nums.forEach(([v, l, d], i) => {
    const y = 3.66 + i * 0.94;
    s.addText(v, { x: 8.58, y, w: 1.15, h: 0.55, fontFace: FONT_SERIF, fontSize: 27, color: C.goldBright, align: 'left', valign: 'top' });
    s.addText(l, { x: 9.85, y, w: 2.75, h: 0.3, fontFace: FONT_SANS, fontSize: 10.5, bold: true, color: C.ink, align: 'left', valign: 'top' });
    s.addText(d, { x: 9.85, y: y + 0.28, w: 2.75, h: 0.4, fontFace: FONT_SANS, fontSize: 8.5, color: C.dim, align: 'left', valign: 'top', lineSpacingMultiple: 1.25 });
  });

  footer(s, 6);
  s.addNotes('Private-by-default rooms, verified Google sign-in, role-based capabilities, TOTP-protected admin, rate limiting, and automatic archiving.');
}

/* ---------------------------------------------------------------------------
 * 07 — Platform & plugins
 * ------------------------------------------------------------------------- */
function slidePlatform() {
  const s = slide();
  kicker(s, M, 0.5, 'PLATFORM / 06');
  title(s, [
    { text: 'An extensible ', options: {} },
    { text: 'plugin platform', options: { italic: true, color: C.goldBright } },
    { text: ' inside the room.', options: {} },
  ]);
  body(s, 'Built-in tools cover the common cases; a reviewed community catalogue covers the rest — without ever leaving the canvas.');

  panel(s, M, 3.05, 7.6, 3.05);
  panelKicker(s, 0.73, 3.28, 'BUILT-IN TOOLKIT');
  numberedRows(s, 0.75, 3.72, 7.25, [
    { strong: 'Notes', rest: 'editable text on the board' },
    { strong: 'Tags', rest: 'annotate selected content' },
    { strong: 'Statistics', rest: 'quick computations at the board' },
    { strong: 'Mathematical Set', rest: 'Venn diagrams, number lines, coordinate grids, set symbols' },
  ], 0.58);

  panel(s, 8.4, 3.05, 4.38, 3.05);
  panelKicker(s, 8.58, 3.28, 'DEVELOPER WORKSPACE');
  checkRows(s, 8.63, 3.7, 3.95, [
    { strong: 'Manifest', rest: 'identity, version, permissions, commands, tools, entry bundle' },
    { strong: 'Safe bridge', rest: 'postMessage only — no store, cookies, or socket internals' },
    { strong: 'Lifecycle', rest: 'draft, version, review, approval, publish' },
    { strong: 'Reviewed', rest: 'administrators smoke-test every submission' },
  ], 0.585);

  panel(s, M, 6.3, 12.23, 0.55, { fill: '14171A', line: C.goldLine });
  s.addText([
    { text: '15% ', options: { fontFace: FONT_SERIF, fontSize: 15, italic: true, color: C.goldBright } },
    { text: 'of Pro and Team revenue funds the plugin developers whose tools you use.', options: { fontFace: FONT_SANS, fontSize: 10.5, color: C.muted } },
  ], { x: M + 0.3, y: 6.3, w: 11.6, h: 0.55, align: 'center', valign: 'middle' });

  footer(s, 7);
  s.addNotes('Built-in toolkit plus a developer workspace with a reviewed publish lifecycle and a 15% revenue share for plugin developers.');
}

/* ---------------------------------------------------------------------------
 * 08 — Business model
 * ------------------------------------------------------------------------- */
function slideBusiness() {
  const s = slide();
  kicker(s, M, 0.5, 'BUSINESS / 07');
  title(s, [
    { text: 'Free to teach. ', options: {} },
    { text: 'Subscribed to keep.', options: { italic: true, color: C.goldBright } },
  ]);
  body(s, 'A defined Free tier, a Pro tier for work worth keeping, and a Team workspace for whole departments. No participant paywall, ever.');

  const plans = [
    {
      name: 'FREE',
      price: '$0',
      per: 'forever',
      lines: ['5 active rooms', '25 participants per room', '7-day board retention', '200 voice minutes / month'],
      recommended: false,
    },
    {
      name: 'PRO',
      price: '$5',
      per: 'per month · $50 / year',
      lines: ['Unlimited rooms', '100 participants per room', 'Boards kept indefinitely', 'Full plugin catalogue + publishing', 'PNG / SVG / PDF export', '1,500 voice minutes / month'],
      recommended: true,
    },
    {
      name: 'TEAM',
      price: '$30',
      per: 'per month · $300 / year',
      lines: ['10 seats in one workspace', '300 participants per room', '10,000 pooled voice minutes', 'Member admin, one invoice', 'Custom branding, priority support'],
      recommended: false,
    },
  ];
  const cardW = 3.94;
  const cardH = 3.15;
  const gapX = 0.2;
  plans.forEach((plan, i) => {
    const x = M + i * (cardW + gapX);
    const recommended = plan.recommended;
    panel(s, x, 3.05, cardW, cardH, { line: recommended ? C.goldLine : C.line });
    if (recommended) {
      s.addText('RECOMMENDED', {
        x: x + cardW - 1.45, y: 3.05, w: 1.3, h: 0.28,
        fontFace: FONT_SANS, fontSize: 6.5, bold: true, charSpacing: 1.2, color: C.bg,
        fill: { color: C.goldBright }, align: 'center', valign: 'middle',
      });
    }
    s.addText(plan.name, { x: x + 0.28, y: 3.42, w: cardW - 0.56, h: 0.25, fontFace: FONT_MONO, fontSize: 9, bold: true, charSpacing: 1.5, color: C.goldBright });
    s.addText([
      { text: plan.price, options: { fontFace: FONT_SERIF, fontSize: 34, color: C.goldBright } },
      { text: `  ${plan.per}`, options: { fontFace: FONT_SANS, fontSize: 8.5, color: C.dim } },
    ], { x: x + 0.28, y: 3.74, w: cardW - 0.56, h: 0.6, align: 'left', valign: 'top' });
    plan.lines.forEach((line, j) => {
      const ly = 4.48 + j * 0.285;
      s.addText([
        { text: '— ', options: { color: C.gold } },
        { text: line, options: { color: C.ink } },
      ], { x: x + 0.28, y: ly, w: cardW - 0.5, h: 0.26, fontFace: FONT_SANS, fontSize: 9.5, color: C.ink, align: 'left', valign: 'top' });
    });
  });

  s.addText('Self-serve hosted checkout and subscriptions (card, bank transfer, mobile money) with a customer portal; add-on seats for Team. Includes a 15% developer pool on paid revenue.', {
    x: M, y: 6.36, w: 12.23, h: 0.5,
    fontFace: FONT_SANS, fontSize: 9.5, color: C.dim, align: 'left', valign: 'top', lineSpacingMultiple: 1.3,
  });

  footer(s, 8);
  s.addNotes('Free / Pro / Team tiers from the pricing constants: retention, rooms, participants, voice minutes, seats, plugins, export, branding, workspace admin, priority support.');
}

/* ---------------------------------------------------------------------------
 * 09 — Technology
 * ------------------------------------------------------------------------- */
function slideStack() {
  const s = slide();
  kicker(s, M, 0.5, 'STACK / 08');
  title(s, [
    { text: 'Realtime by design, ', options: {} },
    { text: 'typed end to end.', options: { italic: true, color: C.goldBright } },
  ]);
  body(s, 'A deliberately small stack: one Node.js process serves the API, realtime, and the compiled frontend.');

  const chips = [
    ['React + TypeScript + Vite', 'typed browser app, canvas renderers, Zustand state'],
    ['Hono + Socket.IO', 'HTTP API and authenticated realtime rooms, Redis adapter'],
    ['PostgreSQL + Drizzle', 'users, rooms, members, plugins, billing, migrations'],
    ['Redis + BullMQ', 'live canvas state, presence, rate limits, cleanup jobs'],
    ['LiveKit + Google Identity', 'scoped voice tokens, verified server-side sign-in'],
    ['Cloudflare R2 + Zod', 'plugin assets; validated payloads and structured logs'],
  ];
  const chipW = 3.94;
  const chipH = 1.32;
  const gapX = 0.2;
  const gapY = 0.22;
  chips.forEach(([label, desc], i) => {
    const x = M + (i % 3) * (chipW + gapX);
    const y = 3.15 + Math.floor(i / 3) * (chipH + gapY);
    panel(s, x, y, chipW, chipH);
    s.addShape('rect', { x, y, w: 0.05, h: chipH, fill: { color: C.gold }, line: { color: C.gold, width: 0.1 } });
    s.addText(label, { x: x + 0.28, y: y + 0.22, w: chipW - 0.5, h: 0.35, fontFace: FONT_SANS, fontSize: 12, bold: true, color: C.ink });
    s.addText(desc, { x: x + 0.28, y: y + 0.62, w: chipW - 0.55, h: 0.6, fontFace: FONT_SANS, fontSize: 9.5, color: C.muted, lineSpacingMultiple: 1.3 });
  });

  panel(s, M, 6.12, 12.23, 0.55, { fill: '14171A', line: C.goldLine });
  s.addText('Development mirrors production: Vite proxies /api and /socket.io to the same backend — one process, one contract.', {
    x: M + 0.3, y: 6.12, w: 11.6, h: 0.55,
    fontFace: FONT_SANS, fontSize: 10.5, color: C.muted, align: 'center', valign: 'middle',
  });

  footer(s, 9);
  s.addNotes('React/TS/Vite, Hono + Socket.IO with Redis adapter, PostgreSQL + Drizzle, Redis + BullMQ, LiveKit voice, Google Identity, R2 plugin storage.');
}

/* ---------------------------------------------------------------------------
 * 10 — Status & next steps
 * ------------------------------------------------------------------------- */
function slideStatus() {
  const s = slide();
  kicker(s, M, 0.5, 'STATUS / 09');
  title(s, [
    { text: 'Beta is ', options: {} },
    { text: 'live.', options: { italic: true, color: C.goldBright } },
    { text: ' The room is open.', options: {} },
  ]);
  body(s, 'chalkboard.click is running today with realtime rooms, a full plugin lifecycle, self-serve billing, and a guarded admin console.');

  panel(s, M, 3.05, 7.6, 3.2);
  panelKicker(s, 0.73, 3.28, 'SHIPPED / TODAY');
  checkRows(s, 0.78, 3.7, 7.15, [
    { strong: 'Realtime rooms', rest: 'history, reconnection, voice, roles, access modes' },
    { strong: 'Canvas toolkit', rest: 'chalk, shapes, notes, links, selection, sync' },
    { strong: 'Plugin platform', rest: 'workspace, review, approval, publishing' },
    { strong: 'Self-serve billing', rest: 'Free / Pro / Team with hosted checkout' },
    { strong: 'Admin console', rest: 'TOTP 2FA, plugin reviews, analytics' },
  ], 0.49);

  panel(s, 8.4, 3.05, 4.38, 3.2);
  panelKicker(s, 8.58, 3.28, 'NEXT / ON THE ROAD');
  numberedRows(s, 8.58, 3.72, 4.05, [
    { strong: 'Onboarding', rest: 'sharpen invites and first-room flow.' },
    { strong: 'Catalogue', rest: 'grow reviewed community plugins.' },
    { strong: 'Scale', rest: 'presence and voice across instances.' },
    { strong: 'Tooling', rest: 'export and workspace administration.' },
  ], 0.62);

  s.addText([
    { text: 'Try it: ', options: { fontFace: FONT_SANS, fontSize: 11, color: C.dim } },
    { text: 'chalkboard.click', options: { fontFace: FONT_MONO, fontSize: 11, color: C.goldBright } },
  ], { x: M, y: 6.45, w: 8, h: 0.4, align: 'left', valign: 'middle' });

  footer(s, 10);
  s.addNotes('Beta is live at chalkboard.click. Shipped: rooms, canvas, plugins, billing, admin. Next: onboarding, catalogue, scale, tooling.');
}

/* ---------------------------------------------------------------------------
 * 11 — Closing
 * ------------------------------------------------------------------------- */
function slideClosing() {
  const s = slide();

  orbit(s, -1.7, -2.1, 4.6, 5.9, 24, C.line, 1.25);
  orbit(s, 10.7, 3.6, 4.4, 3.4, -21, C.line, 1.25);
  orbit(s, 2.2, 5.2, 2.6, 1.7, 10, C.goldLine, 1.1);
  chalkStroke(s, 1.0, 2.6, 2.1, C.goldBright, -8, 85);
  chalkStroke(s, 2.1, 2.9, 1.3, 'F5F2EA', 6, 88);
  chalkStroke(s, 10.3, 2.3, 1.9, C.goldBright, 12, 82);

  kicker(s, 5.72, 1.55, 'CHALKBOARD');
  s.addText([
    { text: 'Move ', options: {} },
    { text: 'together.', options: { italic: true, color: C.goldBright } },
  ], {
    x: 1.67, y: 2.2, w: 10, h: 1.4,
    fontFace: FONT_SERIF, fontSize: 52, color: C.ink,
    align: 'center', valign: 'middle',
  });
  s.addText('Give the next idea somewhere to go — a live room at chalkboard.click, or this repository to read the full plan.', {
    x: 2.67, y: 3.75, w: 8, h: 0.6,
    fontFace: FONT_SANS, fontSize: 12, color: C.muted,
    align: 'center', valign: 'top', lineSpacingMultiple: 1.4,
  });
  ctaButton(s, 5.22, 4.65, 2.9, 'OPEN A ROOM — CHALKBOARD.CLICK');

  footer(s, 11);
  s.addNotes('Closing: Move together. CTA to chalkboard.click and the repository.');
}

/* ---------------------------------------------------------------------------
 * Build & write
 * ------------------------------------------------------------------------- */
slideCover();
slideProblem();
slideSolution();
slideCanvas();
slideRooms();
slideAccess();
slidePlatform();
slideBusiness();
slideStack();
slideStatus();
slideClosing();

await pptx.writeFile({ fileName: 'chalkboard-pitch-deck.pptx' });
console.log('Wrote chalkboard-pitch-deck.pptx');