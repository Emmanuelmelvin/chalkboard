import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Check, Clipboard, Code2, ExternalLink, FileCheck2, FlaskConical, KeyRound, LoaderCircle, LogOut, ShieldCheck, Sparkles, UsersRound, WalletCards, XCircle } from 'lucide-react';
import { addAdmin, beginAdminTwoFactorSetup, getAdminSession, listAdminPlugins, listAdmins, logoutAdminTwoFactor, publishAdminPlugin, removeAdmin, reviewAdminPlugin, verifyAdminTwoFactor, type AdminPlugin, type AdminSession, type AdminUser } from '@/admin/api';
import AdminPluginSandbox from '@/admin/AdminPluginSandbox';
import './Admin.css';

type AdminView = 'plugins' | 'billing' | 'admins';
type TwoFactorMode = 'loading' | 'setup' | 'verify' | 'ready' | 'forbidden';

const adminViews: AdminView[] = ['plugins', 'billing', 'admins'];

function getAdminViewFromUrl(): AdminView {
  const value = new URLSearchParams(window.location.search).get('tab');
  return adminViews.includes(value as AdminView) ? value as AdminView : 'plugins';
}

function formatStatus(value: string) {
  return value.replace('_', ' ');
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown date' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function AdminLoading() {
  return <main className="admin-loading"><LoaderCircle className="admin-spin" size={22} /><span>Checking admin access…</span></main>;
}

function AdminAvatar({ name, avatarUrl }: { name: string; avatarUrl: string | null }) {
  const [imageFailed, setImageFailed] = useState(false);
  const source = avatarUrl?.trim() || '';
  const initials = name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'C';

  if (!source || imageFailed) {
    return <span className="admin-header-avatar admin-header-avatar-fallback" aria-label={name}>{initials}</span>;
  }

  return <img className="admin-header-avatar" src={source} alt={name} referrerPolicy="no-referrer" onError={() => setImageFailed(true)} />;
}

export default function AdminDashboard() {
  const [session, setSession] = useState<AdminSession | null>(null);
  const [twoFactorMode, setTwoFactorMode] = useState<TwoFactorMode>('loading');
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [code, setCode] = useState('');
  const [plugins, setPlugins] = useState<AdminPlugin[]>([]);
  const [selectedPluginId, setSelectedPluginId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('in_review');
  const [view, setView] = useState<AdminView>(() => getAdminViewFromUrl());
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [newAdminEmail, setNewAdminEmail] = useState('');
  const [newAdminRole, setNewAdminRole] = useState<'admin' | 'super_admin'>('admin');
  const [testResult, setTestResult] = useState<{ pluginId: string; passed: boolean; message: string } | null>(null);
  const [sandboxOpen, setSandboxOpen] = useState(false);

  const selectedPlugin = useMemo(() => plugins.find((plugin) => plugin.pluginId === selectedPluginId) ?? null, [plugins, selectedPluginId]);

  const loadPlugins = async (filter = statusFilter) => {
    setBusy(true);
    try {
      const payload = await listAdminPlugins(filter || undefined);
      setPlugins(payload.plugins);
      setSelectedPluginId((current) => current && payload.plugins.some((plugin) => plugin.pluginId === current) ? current : payload.plugins[0]?.pluginId ?? null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'We could not load plugin submissions.');
    } finally {
      setBusy(false);
    }
  };

  const prepareTwoFactor = async () => {
    try {
      const payload = await beginAdminTwoFactorSetup();
      setSetup(payload);
      setTwoFactorMode('setup');
    } catch (setupError) {
      setError(setupError instanceof Error ? setupError.message : 'We could not start 2FA setup.');
      setTwoFactorMode('forbidden');
    }
  };

  // This bootstrap effect intentionally runs once; subsequent plugin reloads are explicit user actions.
  useEffect(() => {
    void getAdminSession().then(async (payload) => {
      setSession(payload);
      if (!payload.twoFactorEnabled) {
        await prepareTwoFactor();
      } else if (payload.twoFactorVerified) {
        setTwoFactorMode('ready');
        await loadPlugins();
      } else {
        setTwoFactorMode('verify');
      }
    }).catch((sessionError: Error & { status?: number }) => {
      setError(sessionError.message);
      setTwoFactorMode(sessionError.status === 403 ? 'forbidden' : 'verify');
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handlePopState = () => setView(getAdminViewFromUrl());
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const handleVerify = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const payload = await verifyAdminTwoFactor(code);
      setRecoveryCodes(payload.recoveryCodes);
      setCode('');
      setTwoFactorMode('ready');
      await loadPlugins();
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : 'That 2FA code was not accepted.');
    } finally {
      setBusy(false);
    }
  };

  const replacePlugin = (plugin: AdminPlugin) => {
    setPlugins((current) => current.map((item) => item.pluginId === plugin.pluginId ? plugin : item));
    setSelectedPluginId(plugin.pluginId);
  };

  const handleReview = async (decision: 'approved' | 'rejected' | 'suspended') => {
    if (!selectedPlugin) return;
    if (decision === 'approved' && (!testResult || testResult.pluginId !== selectedPlugin.pluginId || !testResult.passed)) {
      setError('Run the plugin smoke test before approving this submission.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const payload = await reviewAdminPlugin(selectedPlugin.pluginId, decision, notes);
      replacePlugin(payload.plugin);
      setNotice(`Plugin ${decision}.`);
      setNotes('');
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : 'We could not update this plugin review.');
    } finally {
      setBusy(false);
    }
  };

  const runPluginTest = () => {
    if (!selectedPlugin) return;
    const version = selectedPlugin.versions[0];
    const manifest = version?.manifest;
    const issues: string[] = [];
    if (!version) issues.push('No version is attached.');
    if (!manifest || manifest.id !== selectedPlugin.pluginId) issues.push('Manifest ID does not match the plugin ID.');
    if (version && manifest?.version !== version.version) issues.push('Manifest version does not match the submitted version.');
    if (!manifest || !Array.isArray(manifest.permissions)) issues.push('Manifest permissions are missing.');
    if (!manifest || !manifest.contributes || typeof manifest.contributes !== 'object') issues.push('Manifest contributions are missing.');
    if (!version?.entryCode?.trim()) {
      issues.push('No JavaScript bundle was uploaded.');
    } else {
      try {
        // Compile only: the submitted bundle is never executed by the admin console.
        new Function(version.entryCode);
      } catch (bundleError) {
        issues.push(`Bundle syntax error: ${bundleError instanceof Error ? bundleError.message : 'invalid JavaScript'}`);
      }
    }
    const passed = issues.length === 0;
    setTestResult({ pluginId: selectedPlugin.pluginId, passed, message: passed ? `Manifest, contribution, and JavaScript bundle passed.${version?.hasBundleArchive || version?.bundleArchiveDataUrl ? ' ZIP package attached.' : ' No ZIP package attached.'}` : issues.join(' ') });
    setError('');
    setNotice(passed ? 'Plugin smoke test passed.' : 'Plugin smoke test found issues.');
  };

  const handlePublish = async () => {
    if (!selectedPlugin) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const payload = await publishAdminPlugin(selectedPlugin.pluginId);
      replacePlugin(payload.plugin);
      setNotice('Plugin published to the Chalkboard catalogue.');
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : 'We could not publish this plugin.');
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = async () => {
    await logoutAdminTwoFactor().catch(() => undefined);
    window.location.href = '/';
  };

  const loadAdmins = async () => {
    setBusy(true);
    try {
      const payload = await listAdmins();
      setAdmins(payload.admins);
    } catch (adminError) {
      setError(adminError instanceof Error ? adminError.message : 'We could not load administrators.');
    } finally {
      setBusy(false);
    }
  };

  const handleAddAdmin = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const payload = await addAdmin(newAdminEmail, newAdminRole);
      setAdmins((current) => [...current.filter((admin) => admin.id !== payload.admin.id), payload.admin]);
      setNewAdminEmail('');
      setNotice(`${payload.admin.email} can now enter the admin console.`);
    } catch (adminError) {
      setError(adminError instanceof Error ? adminError.message : 'We could not add that administrator.');
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveAdmin = async (admin: AdminUser) => {
    setBusy(true);
    setError('');
    try {
      await removeAdmin(admin.id);
      setAdmins((current) => current.filter((item) => item.id !== admin.id));
      setNotice(`${admin.email} no longer has admin access.`);
    } catch (adminError) {
      setError(adminError instanceof Error ? adminError.message : 'We could not remove that administrator.');
    } finally {
      setBusy(false);
    }
  };

  const selectView = (nextView: AdminView) => {
    setView(nextView);
    setError('');
    setNotice('');
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set('tab', nextView);
    window.history.pushState({ adminTab: nextView }, '', `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
    if (nextView === 'admins') void loadAdmins();
  };

  if (twoFactorMode === 'loading') return <AdminLoading />;
  if (twoFactorMode === 'forbidden') return <main className="admin-loading admin-loading-error"><ShieldCheck size={26} /><h1>Admin access required</h1><p>{error || 'This account is not allowed to use the admin console.'}</p><a href="/">Return to Chalkboard</a></main>;
  if (twoFactorMode === 'setup' && setup) return <main className="admin-auth-shell"><section className="admin-auth-card"><div className="admin-brand"><span>C</span><div><strong>Chalkboard</strong><small>Admin console</small></div></div><div className="admin-auth-icon"><KeyRound size={22} /></div><p className="admin-eyebrow">First access / 2FA setup</p><h1>Secure the console.</h1><p className="admin-auth-copy">Add this account to your authenticator app. Admin actions stay locked until the code is verified.</p><div className="admin-secret-block"><span>Setup key</span><code>{setup.secret}</code><button type="button" onClick={() => { void navigator.clipboard.writeText(setup.secret); }}>Copy key <Clipboard size={13} /></button></div><p className="admin-otpauth">If your authenticator supports it, use this provisioning URI:</p><code className="admin-uri">{setup.otpauthUri}</code><form className="admin-auth-form" onSubmit={handleVerify}><label htmlFor="admin-setup-code">Authenticator code</label><input id="admin-setup-code" value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" maxLength={6} /><button className="admin-primary-button" type="submit" disabled={busy}>{busy ? 'Verifying…' : 'Verify and enter'}</button></form>{error && <p className="admin-error">{error}</p>}</section></main>;
  if (twoFactorMode === 'verify') return <main className="admin-auth-shell"><section className="admin-auth-card"><div className="admin-brand"><span>C</span><div><strong>Chalkboard</strong><small>Admin console</small></div></div><div className="admin-auth-icon"><ShieldCheck size={22} /></div><p className="admin-eyebrow">Admin verification</p><h1>One more step.</h1><p className="admin-auth-copy">Enter the six-digit code from your authenticator app to open the admin console.</p><form className="admin-auth-form" onSubmit={handleVerify}><label htmlFor="admin-login-code">Authenticator code</label><input id="admin-login-code" value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" maxLength={6} autoFocus /><button className="admin-primary-button" type="submit" disabled={busy}>{busy ? 'Checking…' : 'Open admin console'}</button></form>{error && <p className="admin-error">{error}</p>}</section></main>;

  return (
    <div className="admin-app">
      <aside className="admin-sidebar"><div className="admin-brand"><span>C</span><div><strong>Chalkboard</strong><small>Admin console</small></div></div><div className="admin-sidebar-rule" /><p className="admin-sidebar-label">Control plane</p><nav className="admin-nav" aria-label="Admin sections"><button className={view === 'plugins' ? 'is-active' : ''} type="button" onClick={() => selectView('plugins')}><Code2 size={16} /> Plugins</button><button className={view === 'billing' ? 'is-active' : ''} type="button" onClick={() => selectView('billing')}><WalletCards size={16} /> Plans & coupons</button><button className={view === 'admins' ? 'is-active' : ''} type="button" onClick={() => selectView('admins')}><UsersRound size={16} /> Administrators</button></nav><div className="admin-sidebar-bottom"><div><ShieldCheck size={15} /><span>2FA protected</span></div><span>{session?.user.email}</span><button type="button" onClick={() => { void handleLogout(); }}><LogOut size={14} /> Sign out</button></div></aside>
      <main className="admin-main"><header className="admin-header"><div><p className="admin-eyebrow">Chalkboard / {view === 'plugins' ? 'Plugin review' : view === 'billing' ? 'Plans & coupons' : 'Administrators'}</p><h1>{view === 'plugins' ? 'Review the next tool.' : view === 'billing' ? 'Shape access.' : 'Protect the people who run it.'}</h1></div><div className="admin-header-user"><AdminAvatar name={session?.user.displayName || 'Admin'} avatarUrl={session?.user.avatarUrl || null} /><div className="admin-header-user-copy"><span>{session?.user.platformRole === 'super_admin' ? 'Super Admin' : 'Admin'}</span><strong>{session?.user.displayName}</strong></div></div></header>
        {view === 'billing' ? <section className="admin-placeholder"><Sparkles size={24} /><h2>Billing controls are next.</h2><p>The protected admin shell is ready for plans, coupons, subscription waivers, and provider-backed subscription events.</p></section> : view === 'admins' ? <section className="admin-admin-workspace"><div className="admin-panel"><div className="admin-panel-heading"><div><p className="admin-eyebrow">Access control</p><h2>Administrators</h2></div>{session?.user.platformRole === 'super_admin' && <span className="admin-status is-approved">Super Admin</span>}</div><div className="admin-admin-list">{admins.map((admin) => <div className="admin-admin-row" key={admin.id}><span className="admin-queue-icon"><UsersRound size={15} /></span><span><strong>{admin.displayName}</strong><small>{admin.email}</small></span><em className={`admin-status is-${admin.platformRole === 'super_admin' ? 'approved' : 'in_review'}`}>{admin.platformRole.replace('_', ' ')}</em>{session?.user.platformRole === 'super_admin' && admin.platformRole === 'admin' && <button className="admin-secondary-button" type="button" disabled={busy} onClick={() => { void handleRemoveAdmin(admin); }}>Remove</button>}</div>)}</div>{session?.user.platformRole === 'super_admin' && <form className="admin-add-form" onSubmit={handleAddAdmin}><label htmlFor="admin-new-email">Add an existing Chalkboard user</label><div><input id="admin-new-email" type="email" value={newAdminEmail} onChange={(event) => setNewAdminEmail(event.target.value)} placeholder="person@example.com" required /><select value={newAdminRole} onChange={(event) => setNewAdminRole(event.target.value as 'admin' | 'super_admin')}><option value="admin">Admin</option><option value="super_admin">Super Admin</option></select><button className="admin-primary-button" type="submit" disabled={busy}>Add admin</button></div><small>The user must sign in once before they can be promoted.</small></form>}{(error || notice) && <p className={`admin-feedback${notice && !error ? ' is-success' : ''}`}>{error || notice}</p>}</div></section> : <>
          <section className="admin-stat-grid"><article><span>Review queue</span><strong>{plugins.length.toString().padStart(2, '0')}</strong><small>{statusFilter === 'in_review' ? 'awaiting a decision' : 'matching this filter'}</small></article><article><span>Selected plan</span><strong>{selectedPlugin?.plan === 'pro' ? 'PRO' : '—'}</strong><small>{selectedPlugin ? selectedPlugin.name : 'choose a plugin'}</small></article><article><span>Console role</span><strong>{session?.user.platformRole === 'super_admin' ? 'ROOT' : 'ADMIN'}</strong><small>2FA verified session</small></article></section>
          <section className="admin-plugin-workspace"><div className="admin-panel admin-plugin-list"><div className="admin-panel-heading"><div><p className="admin-eyebrow">Submissions</p><h2>Plugin queue</h2></div><select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); void loadPlugins(event.target.value); }}><option value="in_review">In review</option><option value="approved">Approved</option><option value="published">Published</option><option value="rejected">Rejected</option><option value="">All plugins</option></select></div>{busy && plugins.length === 0 ? <div className="admin-empty"><LoaderCircle className="admin-spin" size={18} /> Loading queue…</div> : plugins.length === 0 ? <div className="admin-empty"><FileCheck2 size={23} /><strong>Nothing in this queue.</strong><span>New submissions will appear here when developers send them for review.</span></div> : <div className="admin-queue">{plugins.map((plugin) => <button className={`admin-queue-row${selectedPluginId === plugin.pluginId ? ' is-selected' : ''}`} type="button" key={plugin.pluginId} onClick={() => setSelectedPluginId(plugin.pluginId)}><span className="admin-queue-icon"><Code2 size={15} /></span><span><strong>{plugin.name}</strong><small>{plugin.author?.email || 'Unknown author'} · v{plugin.versions[0]?.version || '—'}</small></span><em className={`admin-status is-${plugin.status}`}>{formatStatus(plugin.status)}</em></button>)}</div>}</div><div className="admin-panel admin-plugin-detail">{selectedPlugin ? <><div className="admin-detail-heading"><div><p className="admin-eyebrow">Submission detail</p><h2>{selectedPlugin.name}</h2><span>{selectedPlugin.pluginId}</span></div><em className={`admin-status is-${selectedPlugin.status}`}>{formatStatus(selectedPlugin.status)}</em></div><div className="admin-detail-meta"><span>Author <strong>{selectedPlugin.author?.displayName || 'Unknown'}</strong></span><span>Access <strong>{selectedPlugin.plan === 'pro' ? 'Pro' : 'Free'}</strong></span><span>Updated <strong>{formatDate(selectedPlugin.updatedAt)}</strong></span></div><p className="admin-detail-description">{selectedPlugin.description}</p><div className="admin-version-card"><div><p className="admin-eyebrow">Latest version</p><strong>v{selectedPlugin.versions[0]?.version || '—'}</strong><small>{selectedPlugin.versions[0]?.changelog || 'No changelog provided.'}</small></div>{selectedPlugin.versions[0]?.entryUrl && <a href={selectedPlugin.versions[0].entryUrl} target="_blank" rel="noreferrer">Open bundle <ExternalLink size={13} /></a>}</div><details className="admin-manifest-details"><summary>Inspect manifest</summary><pre>{JSON.stringify(selectedPlugin.versions[0]?.manifest || {}, null, 2)}</pre></details><details className="admin-manifest-details"><summary>Inspect uploaded bundle</summary><pre>{selectedPlugin.versions[0]?.entryCode ? `${selectedPlugin.versions[0].entryCode.slice(0, 12000)}${selectedPlugin.versions[0].entryCode.length > 12000 ? '\n\n/* preview truncated */' : ''}` : 'No inline bundle uploaded.'}</pre></details>{['in_review', 'approved'].includes(selectedPlugin.status) && <div className="admin-review-form"><label htmlFor="admin-review-notes">Review notes</label><textarea id="admin-review-notes" rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Record what was tested or what needs to change." /><div className="admin-review-actions">{selectedPlugin.status === 'in_review' && <><button className="admin-secondary-button" type="button" disabled={busy} onClick={() => { void handleReview('rejected'); }}><XCircle size={14} /> Reject</button><button className="admin-secondary-button admin-approve-button" type="button" disabled={busy} onClick={() => { void handleReview('approved'); }}><Check size={14} /> Approve</button></>}{selectedPlugin.status === 'approved' && <button className="admin-primary-button" type="button" disabled={busy} onClick={() => { void handlePublish(); }}><Sparkles size={14} /> Publish to catalogue</button>}</div></div>}{(error || notice) && <p className={`admin-feedback${notice && !error ? ' is-success' : ''}`}>{error || notice}</p>}</> : <div className="admin-empty admin-detail-empty"><FileCheck2 size={28} /><h2>Select a submission.</h2><p>Choose a plugin from the queue to inspect its manifest and record a review decision.</p></div>}</div></section>
        </>}
      </main>
      {view === 'plugins' && selectedPlugin && <section className={`admin-quick-test${testResult?.pluginId === selectedPlugin.pluginId && testResult.passed ? ' is-passed' : ''}`}><div><p className="admin-eyebrow">Test lab</p><strong>{testResult?.pluginId === selectedPlugin.pluginId ? testResult.message : 'Run the smoke test before approval.'}</strong></div><div className="admin-quick-test-actions"><button className="admin-secondary-button" type="button" disabled={busy} onClick={runPluginTest}><FileCheck2 size={14} /> Run test</button><button className="admin-primary-button" type="button" disabled={busy} onClick={() => setSandboxOpen(true)}><FlaskConical size={14} /> Open sandbox</button></div></section>}
      {sandboxOpen && selectedPlugin && <AdminPluginSandbox key={`${selectedPlugin.pluginId}-${selectedPlugin.versions[0]?.version || 'draft'}`} plugin={selectedPlugin} onClose={() => setSandboxOpen(false)} />}
      {recoveryCodes.length > 0 && <div className="admin-recovery-overlay"><section className="admin-recovery-card"><div className="admin-auth-icon"><KeyRound size={22} /></div><p className="admin-eyebrow">Save these once</p><h2>Recovery codes</h2><p>Store these somewhere secure. Each code can be used once if you lose access to your authenticator.</p><div className="admin-recovery-grid">{recoveryCodes.map((recoveryCode) => <code key={recoveryCode}>{recoveryCode}</code>)}</div><button className="admin-primary-button" type="button" onClick={() => setRecoveryCodes([])}>I saved my codes</button></section></div>}
    </div>
  );
}
