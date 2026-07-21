import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowLeft, CheckCircle2, Code2, FileJson, GitBranch, LoaderCircle, Plus, Send, Sparkles } from 'lucide-react';
import { installedPlugins } from '@/plugins/installedPlugins';
import { createPlugin, createPluginVersion, listMyPlugins, submitPlugin, type ManagedPlugin, type ManagedPluginPlan } from '@/plugins/management';

const DEFAULT_MANIFEST = (pluginId: string, name: string, version: string) => JSON.stringify({
  id: pluginId || 'your.plugin',
  name: name || 'My plugin',
  version: version || '0.1.0',
  description: 'Describe what your plugin contributes to Chalkboard.',
  author: 'Your name',
  permissions: ['board:write'],
  contributes: { tools: [], commands: [] },
}, null, 2);

function statusLabel(status: ManagedPlugin['status']) {
  return status.replace('_', ' ');
}

function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Recently updated' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function parseManifest(value: string) {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Manifest must be a JSON object.');
  return parsed as Record<string, unknown>;
}

export default function DeveloperPlugins() {
  const [plugins, setPlugins] = useState<ManagedPlugin[]>([]);
  const [selectedPluginId, setSelectedPluginId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ pluginId: '', name: '', description: '', plan: 'free' as ManagedPluginPlan, version: '0.1.0', manifest: DEFAULT_MANIFEST('', '', '0.1.0'), changelog: '', entryUrl: '' });
  const [versionForm, setVersionForm] = useState({ version: '0.2.0', manifest: '', changelog: '', entryUrl: '' });

  const selectedPlugin = useMemo(() => plugins.find((plugin) => plugin.pluginId === selectedPluginId) ?? null, [plugins, selectedPluginId]);
  const latestVersion = selectedPlugin?.versions[0] ?? null;

  const loadPlugins = async () => {
    setLoading(true);
    try {
      const payload = await listMyPlugins();
      setPlugins(payload.plugins);
      const nextPlugin = selectedPluginId && payload.plugins.some((plugin) => plugin.pluginId === selectedPluginId)
        ? payload.plugins.find((plugin) => plugin.pluginId === selectedPluginId)
        : payload.plugins[0];
      setSelectedPluginId(nextPlugin?.pluginId ?? null);
      if (nextPlugin) {
        setVersionForm({ version: '0.2.0', manifest: JSON.stringify(nextPlugin.versions[0]?.manifest ?? {}, null, 2), changelog: '', entryUrl: nextPlugin.versions[0]?.entryUrl ?? '' });
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'We could not load your plugins.');
    } finally {
      setLoading(false);
    }
  };

  // The initial fetch deliberately owns its loading state; this component does not subscribe to external state.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadPlugins();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateSelectedPlugin = (plugin: ManagedPlugin) => {
    setPlugins((current) => current.map((item) => item.pluginId === plugin.pluginId ? plugin : item));
    setSelectedPluginId(plugin.pluginId);
  };

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const payload = await createPlugin({ ...createForm, manifest: parseManifest(createForm.manifest) });
      const plugin = payload.plugin;
      setPlugins((current) => [plugin, ...current]);
      setSelectedPluginId(plugin.pluginId);
      setCreateOpen(false);
      setCreateForm({ pluginId: '', name: '', description: '', plan: 'free', version: '0.1.0', manifest: DEFAULT_MANIFEST('', '', '0.1.0'), changelog: '', entryUrl: '' });
      setNotice('Draft created. Add a version and submit it when it is ready for review.');
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'We could not create the plugin.');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateVersion = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedPlugin) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const payload = await createPluginVersion(selectedPlugin.pluginId, { ...versionForm, manifest: parseManifest(versionForm.manifest) });
      updateSelectedPlugin(payload.plugin);
      setNotice(`Version ${versionForm.version} added.`);
    } catch (versionError) {
      setError(versionError instanceof Error ? versionError.message : 'We could not add that version.');
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async () => {
    if (!selectedPlugin) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const payload = await submitPlugin(selectedPlugin.pluginId);
      updateSelectedPlugin(payload.plugin);
      setNotice('Plugin submitted for admin review.');
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'We could not submit the plugin.');
    } finally {
      setSaving(false);
    }
  };

  const updateManifestFromBasics = (pluginId: string, name: string, version: string) => {
    setCreateForm((current) => ({ ...current, pluginId, name, version, manifest: DEFAULT_MANIFEST(pluginId, name, version) }));
  };

  const renderCreateForm = () => (
    <section className="dashboard-developer-create-panel dashboard-developer-create-screen">
      <div className="dashboard-developer-form-heading">
        <div><p className="dashboard-panel-kicker">New plugin</p><strong>Start with the contract.</strong></div>
        <button className="dashboard-link-button" type="button" onClick={() => setCreateOpen(false)}><ArrowLeft size={14} /> Go back</button>
      </div>
      <form className="dashboard-developer-form" onSubmit={handleCreate}>
        <div className="dashboard-developer-two-col"><div><label htmlFor="developer-plugin-id">Plugin ID</label><input id="developer-plugin-id" value={createForm.pluginId} onChange={(event) => updateManifestFromBasics(event.target.value, createForm.name, createForm.version)} placeholder="studio.geometry" /></div><div><label htmlFor="developer-plugin-name">Name</label><input id="developer-plugin-name" value={createForm.name} onChange={(event) => updateManifestFromBasics(createForm.pluginId, event.target.value, createForm.version)} placeholder="Geometry Studio" /></div></div>
        <label htmlFor="developer-plugin-description">Description</label><textarea id="developer-plugin-description" rows={3} value={createForm.description} onChange={(event) => setCreateForm((current) => ({ ...current, description: event.target.value }))} placeholder="What does this plugin help people do?" />
        <div className="dashboard-developer-two-col"><div><label htmlFor="developer-plugin-version">First version</label><input id="developer-plugin-version" value={createForm.version} onChange={(event) => updateManifestFromBasics(createForm.pluginId, createForm.name, event.target.value)} placeholder="0.1.0" /></div><div><label htmlFor="developer-plugin-plan">Access plan</label><select id="developer-plugin-plan" value={createForm.plan} onChange={(event) => setCreateForm((current) => ({ ...current, plan: event.target.value as ManagedPluginPlan }))}><option value="free">Free</option><option value="pro">Pro</option></select></div></div>
        <label htmlFor="developer-plugin-entry-url">Bundle URL <small>optional for now</small></label><input id="developer-plugin-entry-url" value={createForm.entryUrl} onChange={(event) => setCreateForm((current) => ({ ...current, entryUrl: event.target.value }))} placeholder="https://…" type="url" />
        <label htmlFor="developer-plugin-manifest">Manifest JSON</label><textarea id="developer-plugin-manifest" className="dashboard-developer-manifest" rows={10} value={createForm.manifest} onChange={(event) => setCreateForm((current) => ({ ...current, manifest: event.target.value }))} />
        <label htmlFor="developer-plugin-changelog">Changelog</label><textarea id="developer-plugin-changelog" rows={2} value={createForm.changelog} onChange={(event) => setCreateForm((current) => ({ ...current, changelog: event.target.value }))} placeholder="What is included in the first release?" />
        <button className="dashboard-button dashboard-button-gold" type="submit" disabled={saving}><Plus size={15} /> {saving ? 'Creating…' : 'Create plugin draft'}</button>
      </form>
    </section>
  );

  return (
    <div className="dashboard-developer">
      <section className="dashboard-section-intro">
        <div><p className="dashboard-kicker"><span /> Developer workspace / 04</p><h2>Build the next<br /><em>useful tool.</em></h2></div>
        <p>Create plugin drafts, ship versioned manifests, and send finished work to the Chalkboard review queue.</p>
      </section>

      <section className="dashboard-developer-summary" aria-label="Plugin workspace summary">
        <article><span>My plugins</span><strong>{plugins.length.toString().padStart(2, '0')}</strong><small>owned by you</small></article>
        <article><span>In review</span><strong>{plugins.filter((plugin) => plugin.status === 'in_review').length.toString().padStart(2, '0')}</strong><small>waiting for a decision</small></article>
        <article><span>Runtime plugins</span><strong>{installedPlugins.length.toString().padStart(2, '0')}</strong><small>bundled in Chalkboard</small></article>
      </section>

      <section className="dashboard-developer-workspace">
        <div className="dashboard-panel dashboard-developer-list">
          <div className="dashboard-panel-heading"><div><p className="dashboard-panel-kicker">Plugin studio</p><h3>Your plugins</h3></div><button className="dashboard-button dashboard-button-dark dashboard-developer-new" type="button" onClick={() => setCreateOpen((current) => !current)}><Plus size={15} /> New plugin</button></div>
          {loading ? <div className="dashboard-empty-state"><LoaderCircle className="is-spinning" size={20} /> Loading your plugins…</div> : plugins.length === 0 ? (
            <div className="dashboard-developer-empty"><Code2 size={24} /><strong>Your first plugin starts here.</strong><span>Create a draft with a stable ID and manifest, then send it to review when it is ready.</span><button className="dashboard-link-button" type="button" onClick={() => setCreateOpen(true)}>Create a draft <Plus size={14} /></button></div>
          ) : (
            <div className="dashboard-developer-plugin-list">{plugins.map((plugin) => (
              <button className={`dashboard-developer-plugin-row${selectedPluginId === plugin.pluginId ? ' is-selected' : ''}`} type="button" key={plugin.pluginId} onClick={() => { setSelectedPluginId(plugin.pluginId); setVersionForm({ version: '0.2.0', manifest: JSON.stringify(plugin.versions[0]?.manifest ?? {}, null, 2), changelog: '', entryUrl: plugin.versions[0]?.entryUrl ?? '' }); }}>
                <span className="dashboard-developer-plugin-mark"><Sparkles size={16} /></span><span><strong>{plugin.name}</strong><small>{plugin.pluginId} · v{plugin.versions[0]?.version ?? 'draft'}</small></span><em className={`dashboard-plugin-status is-${plugin.status}`}>{statusLabel(plugin.status)}</em>
              </button>
            ))}</div>
          )}
          <div className="dashboard-developer-runtime"><p className="dashboard-panel-kicker">Bundled runtime</p>{installedPlugins.map((plugin) => <div key={plugin.id}><CheckCircle2 size={14} /><span><strong>{plugin.name}</strong><small>v{plugin.version} · available in Chalkboard</small></span></div>)}</div>
        </div>

        <div className="dashboard-panel dashboard-developer-detail">
          {selectedPlugin ? <>
            <div className="dashboard-developer-detail-heading"><div><p className="dashboard-panel-kicker">Plugin detail</p><h3>{selectedPlugin.name}</h3><span>{selectedPlugin.pluginId}</span></div><span className={`dashboard-plugin-status is-${selectedPlugin.status}`}>{statusLabel(selectedPlugin.status)}</span></div>
            <p className="dashboard-panel-copy">{selectedPlugin.description}</p>
            <div className="dashboard-developer-meta"><span><GitBranch size={14} /> {selectedPlugin.plan === 'pro' ? 'Pro access' : 'Free access'}</span><span>Updated {dateLabel(selectedPlugin.updatedAt)}</span></div>
            <div className="dashboard-developer-version-heading"><div><p className="dashboard-panel-kicker">Versions</p><strong>{selectedPlugin.versions.length} release{selectedPlugin.versions.length === 1 ? '' : 's'}</strong></div>{selectedPlugin.currentVersion && <span>Live v{selectedPlugin.currentVersion}</span>}</div>
            <div className="dashboard-developer-versions">{selectedPlugin.versions.map((version) => <div key={version.id}><span><strong>v{version.version}</strong><small>{version.changelog || 'No changelog yet.'}</small></span><em className={`dashboard-plugin-status is-${version.status}`}>{statusLabel(version.status)}</em></div>)}</div>
            <form className="dashboard-developer-form" onSubmit={handleCreateVersion}><div className="dashboard-developer-form-heading"><div><p className="dashboard-panel-kicker">New version</p><strong>Keep releases immutable.</strong></div><span>Latest: v{latestVersion?.version ?? '—'}</span></div><label htmlFor="developer-version">Version</label><input id="developer-version" value={versionForm.version} onChange={(event) => setVersionForm((current) => ({ ...current, version: event.target.value }))} placeholder="0.2.0" /><label htmlFor="developer-entry-url">Bundle URL <small>optional for now</small></label><input id="developer-entry-url" value={versionForm.entryUrl} onChange={(event) => setVersionForm((current) => ({ ...current, entryUrl: event.target.value }))} placeholder="https://…" type="url" /><label htmlFor="developer-changelog">Changelog</label><textarea id="developer-changelog" rows={2} value={versionForm.changelog} onChange={(event) => setVersionForm((current) => ({ ...current, changelog: event.target.value }))} placeholder="What changed in this version?" /><label htmlFor="developer-manifest">Manifest JSON</label><textarea id="developer-manifest" className="dashboard-developer-manifest" rows={9} value={versionForm.manifest} onChange={(event) => setVersionForm((current) => ({ ...current, manifest: event.target.value }))} />
              <div className="dashboard-developer-actions"><button className="dashboard-button dashboard-button-dark" type="submit" disabled={saving}><GitBranch size={15} /> {saving ? 'Saving…' : 'Add version'}</button>{['draft', 'rejected', 'approved', 'published'].includes(selectedPlugin.status) && <button className="dashboard-button dashboard-button-gold" type="button" disabled={saving} onClick={() => { void handleSubmit(); }}><Send size={15} /> Submit for review</button>}</div>
            </form>
          </> : <div className="dashboard-developer-detail-empty"><FileJson size={30} /><h3>Select a plugin</h3><p>Create a plugin draft or select one from the list to manage versions and submissions.</p></div>}
        </div>
      </section>

      {createOpen && <div className="dashboard-developer-create-panel"><div className="dashboard-developer-form-heading"><div><p className="dashboard-panel-kicker">New plugin</p><strong>Start with the contract.</strong></div><button className="dashboard-link-button" type="button" onClick={() => setCreateOpen(false)}>Close</button></div><form className="dashboard-developer-form" onSubmit={handleCreate}><div className="dashboard-developer-two-col"><div><label htmlFor="developer-plugin-id">Plugin ID</label><input id="developer-plugin-id" value={createForm.pluginId} onChange={(event) => updateManifestFromBasics(event.target.value, createForm.name, createForm.version)} placeholder="studio.geometry" /></div><div><label htmlFor="developer-plugin-name">Name</label><input id="developer-plugin-name" value={createForm.name} onChange={(event) => updateManifestFromBasics(createForm.pluginId, event.target.value, createForm.version)} placeholder="Geometry Studio" /></div></div><label htmlFor="developer-plugin-description">Description</label><textarea id="developer-plugin-description" rows={3} value={createForm.description} onChange={(event) => setCreateForm((current) => ({ ...current, description: event.target.value }))} placeholder="What does this plugin help people do?" /><div className="dashboard-developer-two-col"><div><label htmlFor="developer-plugin-version">First version</label><input id="developer-plugin-version" value={createForm.version} onChange={(event) => updateManifestFromBasics(createForm.pluginId, createForm.name, event.target.value)} placeholder="0.1.0" /></div><div><label htmlFor="developer-plugin-plan">Access plan</label><select id="developer-plugin-plan" value={createForm.plan} onChange={(event) => setCreateForm((current) => ({ ...current, plan: event.target.value as ManagedPluginPlan }))}><option value="free">Free</option><option value="pro">Pro</option></select></div></div><label htmlFor="developer-plugin-entry-url">Bundle URL <small>optional for now</small></label><input id="developer-plugin-entry-url" value={createForm.entryUrl} onChange={(event) => setCreateForm((current) => ({ ...current, entryUrl: event.target.value }))} placeholder="https://…" type="url" /><label htmlFor="developer-plugin-manifest">Manifest JSON</label><textarea id="developer-plugin-manifest" className="dashboard-developer-manifest" rows={10} value={createForm.manifest} onChange={(event) => setCreateForm((current) => ({ ...current, manifest: event.target.value }))} /><label htmlFor="developer-plugin-changelog">Changelog</label><textarea id="developer-plugin-changelog" rows={2} value={createForm.changelog} onChange={(event) => setCreateForm((current) => ({ ...current, changelog: event.target.value }))} placeholder="What is included in the first release?" /><button className="dashboard-button dashboard-button-gold" type="submit" disabled={saving}><Plus size={15} /> {saving ? 'Creating…' : 'Create plugin draft'}</button></form></div>}
      {(error || notice) && <p className={`dashboard-error dashboard-developer-feedback${notice && !error ? ' is-success' : ''}`} role="status">{error || notice}</p>}
    </div>
  );
}
