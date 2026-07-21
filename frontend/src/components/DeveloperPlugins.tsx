import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { ArrowLeft, CheckCircle2, Code2, FileJson, GitBranch, LoaderCircle, Plus, Send, Sparkles } from 'lucide-react';
import PluginPackagePicker, { type PluginPackageFile } from '@/components/PluginPackagePicker';
import { createBrowserModuleBundle, findZipEntry, readZipArchive, zipEntryText } from '@/lib/zip';
import { installedPlugins } from '@/plugins/installedPlugins';
import { createPlugin, createPluginVersion, getManagedPluginLogo, listMyPlugins, listPluginCatalogue, submitPlugin, type ManagedPlugin, type ManagedPluginPlan } from '@/plugins/management';
import { useLoggerStore } from '@/stores/loggerStore';

const DEFAULT_MANIFEST = (pluginId: string, name: string, version: string) => JSON.stringify({
  id: pluginId || 'your.plugin',
  name: name || 'My plugin',
  version: version || '0.1.0',
  description: 'Describe what your plugin contributes to Chalkboard.',
  author: 'Your name',
  permissions: ['board:write'],
  contributes: { tools: [], commands: [] },
}, null, 2);

const DEMO_BUNDLE = `(() => {
  const pluginId = 'demo.focus-dot';
  const send = (message) => window.parent.postMessage({ ...message, pluginId }, '*');

  window.addEventListener('message', (event) => {
    if (event.data?.type === 'chalkboard:execute' && event.data.pluginId === pluginId && event.data.command === 'focusDot.add') {
      window.FocusDotPlugin?.add(event.data.payload);
      return;
    }
    if (event.data?.type !== 'chalkboard:init' || event.data.pluginId !== pluginId) return;
    send({ type: 'chalkboard:ready' });
    send({ type: 'chalkboard:register', contributions: {
      tools: [{ id: 'focus-dot.add', label: 'Add Focus Dot', command: 'focusDot.add' }],
      commands: [{ id: 'focusDot.add', title: 'Focus Dot: Add Focus Dot' }],
    }});
  });

  window.FocusDotPlugin = {
    add(executionPayload) {
      const center = executionPayload?.context?.viewportCenter;
      if (!center || typeof center.x !== 'number' || typeof center.y !== 'number') return;
      const points = Array.from({ length: 20 }, (_, index) => {
        const angle = (Math.PI * 2 * index) / 20;
        return { x: center.x + Math.cos(angle) * 10, y: center.y + Math.sin(angle) * 10 };
      });
      send({
        type: 'chalkboard:command',
        command: 'board.insertStrokes',
        payload: {
          strokes: [{ tool: 'chalk', color: '#f6c85f', size: 3, intensity: 1, pathType: 'linear', closed: true, fillColor: '#f6c85f', points }],
          options: { select: true, closeInsertPanel: true },
        },
      });
    },
  };
})();`;

const DEMO_PLUGIN = {
  pluginId: 'demo.focus-dot',
  name: 'Focus Dot',
  description: 'A tiny starter plugin that marks one idea on the canvas.',
  plan: 'free' as ManagedPluginPlan,
  version: '0.1.0',
  manifest: JSON.stringify({
    id: 'demo.focus-dot',
    name: 'Focus Dot',
    version: '0.1.0',
    description: 'Adds a small focus marker to the canvas.',
    author: 'Chalkboard Demo',
    entry: 'index.js',
    icon: 'logo.svg',
    permissions: ['board:write'],
    contributes: {
      tools: [{ id: 'focus-dot.add', label: 'Add Focus Dot', command: 'focusDot.add' }],
      commands: [{ id: 'focusDot.add', title: 'Focus Dot: Add Focus Dot' }],
    },
  }, null, 2),
  changelog: 'First demo release.',
  entryUrl: '',
  entryCode: DEMO_BUNDLE,
  bundleFileName: 'index.js',
};

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

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('We could not read that file.'));
    reader.onerror = () => reject(new Error('We could not read that file.'));
    reader.readAsDataURL(file);
  });
}

export default function DeveloperPlugins() {
  const [plugins, setPlugins] = useState<ManagedPlugin[]>([]);
  const [catalogue, setCatalogue] = useState<ManagedPlugin[]>([]);
  const [selectedPluginId, setSelectedPluginId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [packageLoadingTarget, setPackageLoadingTarget] = useState<'create' | 'version' | null>(null);
  const [manualCreateOpen, setManualCreateOpen] = useState(false);
  const [manualVersionOpen, setManualVersionOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ pluginId: '', name: '', description: '', logoDataUrl: '', plan: 'free' as ManagedPluginPlan, version: '0.1.0', manifest: DEFAULT_MANIFEST('', '', '0.1.0'), changelog: '', entryUrl: '', entryCode: '', bundleFileName: '', bundleArchiveDataUrl: '', archiveFileName: '', manifestFileName: '', packageFiles: [] as PluginPackageFile[] });
  const [versionForm, setVersionForm] = useState({ version: '0.2.0', manifest: '', changelog: '', entryUrl: '', entryCode: '', bundleFileName: '', bundleArchiveDataUrl: '', archiveFileName: '', hasBundleArchive: false, packageFiles: [] as PluginPackageFile[] });

  const selectedPlugin = useMemo(() => plugins.find((plugin) => plugin.pluginId === selectedPluginId) ?? null, [plugins, selectedPluginId]);
  const latestVersion = selectedPlugin?.versions[0] ?? null;

  const loadPlugins = async () => {
    setLoading(true);
    try {
      const [payload, cataloguePayload] = await Promise.all([listMyPlugins(), listPluginCatalogue()]);
      setPlugins(payload.plugins);
      setCatalogue(cataloguePayload.plugins);
      const nextPlugin = selectedPluginId && payload.plugins.some((plugin) => plugin.pluginId === selectedPluginId)
        ? payload.plugins.find((plugin) => plugin.pluginId === selectedPluginId)
        : payload.plugins[0];
      setSelectedPluginId(nextPlugin?.pluginId ?? null);
      if (nextPlugin) setVersionForm({ version: '0.2.0', manifest: JSON.stringify(nextPlugin.versions[0]?.manifest ?? {}, null, 2), changelog: '', entryUrl: nextPlugin.versions[0]?.entryUrl ?? '', entryCode: nextPlugin.versions[0]?.entryCode ?? '', bundleFileName: '', bundleArchiveDataUrl: '', archiveFileName: nextPlugin.versions[0]?.hasBundleArchive || nextPlugin.versions[0]?.bundleArchiveDataUrl ? 'Using previous ZIP package' : '', hasBundleArchive: Boolean(nextPlugin.versions[0]?.hasBundleArchive || nextPlugin.versions[0]?.bundleArchiveDataUrl), packageFiles: [] });
    } catch (loadError) {
      useLoggerStore.getState().notify(loadError instanceof Error ? loadError.message : 'We could not load your plugins.', 'error', 5000);
    } finally {
      setLoading(false);
    }
  };

  // The initial fetch deliberately owns its loading state.
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
    try {
      const payload = await createPlugin({ pluginId: createForm.pluginId, name: createForm.name, description: createForm.description, logoDataUrl: createForm.logoDataUrl, plan: createForm.plan, version: createForm.version, manifest: parseManifest(createForm.manifest), changelog: createForm.changelog, entryUrl: createForm.entryUrl, entryCode: createForm.entryCode, bundleArchiveDataUrl: createForm.bundleArchiveDataUrl });
      setPlugins((current) => [payload.plugin, ...current]);
      setSelectedPluginId(payload.plugin.pluginId);
      setVersionForm({ version: '0.2.0', manifest: JSON.stringify(payload.plugin.versions[0]?.manifest ?? {}, null, 2), changelog: '', entryUrl: payload.plugin.versions[0]?.entryUrl ?? '', entryCode: payload.plugin.versions[0]?.entryCode ?? '', bundleFileName: '', bundleArchiveDataUrl: '', archiveFileName: payload.plugin.versions[0]?.hasBundleArchive || payload.plugin.versions[0]?.bundleArchiveDataUrl ? 'Using previous ZIP package' : '', hasBundleArchive: Boolean(payload.plugin.versions[0]?.hasBundleArchive || payload.plugin.versions[0]?.bundleArchiveDataUrl), packageFiles: [] });
      setCreateOpen(false);
      setCreateForm({ pluginId: '', name: '', description: '', logoDataUrl: '', plan: 'free', version: '0.1.0', manifest: DEFAULT_MANIFEST('', '', '0.1.0'), changelog: '', entryUrl: '', entryCode: '', bundleFileName: '', bundleArchiveDataUrl: '', archiveFileName: '', manifestFileName: '', packageFiles: [] });
      useLoggerStore.getState().notify('Draft created. Add a version and submit it when it is ready for review.', 'success');
    } catch (createError) {
      useLoggerStore.getState().notify(createError instanceof Error ? createError.message : 'We could not create the plugin.', 'error', 5000);
    } finally {
      setSaving(false);
    }
  };

  const handleCreateVersion = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedPlugin) return;
    setSaving(true);
    try {
      const payload = await createPluginVersion(selectedPlugin.pluginId, { ...versionForm, manifest: parseManifest(versionForm.manifest) });
      updateSelectedPlugin(payload.plugin);
      const latestVersion = payload.plugin.versions[0];
      setVersionForm((current) => ({ ...current, version: '0.3.0', changelog: '', entryCode: '', bundleFileName: '', bundleArchiveDataUrl: '', archiveFileName: latestVersion?.hasBundleArchive || latestVersion?.bundleArchiveDataUrl ? 'Using previous ZIP package' : '', hasBundleArchive: Boolean(latestVersion?.hasBundleArchive || latestVersion?.bundleArchiveDataUrl), packageFiles: [] }));
      useLoggerStore.getState().notify(`Version ${versionForm.version} added.`, 'success');
    } catch (versionError) {
      useLoggerStore.getState().notify(versionError instanceof Error ? versionError.message : 'We could not add that version.', 'error', 5000);
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async () => {
    if (!selectedPlugin) return;
    setSaving(true);
    try {
      const payload = await submitPlugin(selectedPlugin.pluginId);
      updateSelectedPlugin(payload.plugin);
      useLoggerStore.getState().notify('Plugin submitted for admin review.', 'success');
    } catch (submitError) {
      useLoggerStore.getState().notify(submitError instanceof Error ? submitError.message : 'We could not submit the plugin.', 'error', 5000);
    } finally {
      setSaving(false);
    }
  };

  const updateManifestFromBasics = (pluginId: string, name: string, version: string) => {
    setCreateForm((current) => ({ ...current, pluginId, name, version, manifest: DEFAULT_MANIFEST(pluginId, name, version) }));
  };

  const useDemoPlugin = () => {
    setCreateForm((current) => ({ ...current, ...DEMO_PLUGIN, logoDataUrl: '', bundleArchiveDataUrl: '', archiveFileName: '', manifestFileName: '', packageFiles: [] }));
    useLoggerStore.getState().notify('Starter example loaded. Add a logo if you want, then create the draft.', 'info');
  };

  const handleManifestFileChange = (event: ChangeEvent<HTMLInputElement>, target: 'create' | 'version') => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 120_000 || (!file.name.toLowerCase().endsWith('.json') && file.type !== 'application/json')) {
      useLoggerStore.getState().notify('Manifest files must be JSON and smaller than 120 KB.', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') return;
      try {
        const parsed = parseManifest(reader.result);
        if (target === 'create') setCreateForm((current) => ({ ...current, manifest: JSON.stringify(parsed, null, 2), manifestFileName: file.name, bundleArchiveDataUrl: '', archiveFileName: '', packageFiles: [] }));
        else setVersionForm((current) => ({ ...current, manifest: JSON.stringify(parsed, null, 2), bundleArchiveDataUrl: '', archiveFileName: '', hasBundleArchive: false, packageFiles: [] }));
      } catch (manifestError) {
        useLoggerStore.getState().notify(manifestError instanceof Error ? manifestError.message : 'That manifest is not valid JSON.', 'error');
      }
    };
    reader.onerror = () => useLoggerStore.getState().notify('We could not read that manifest file.', 'error');
    reader.readAsText(file);
  };

  const handleBundleFileChange = (event: ChangeEvent<HTMLInputElement>, target: 'create' | 'version') => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 480_000 || (!file.name.toLowerCase().endsWith('.js') && !file.name.toLowerCase().endsWith('.mjs') && !file.type.includes('javascript'))) {
      useLoggerStore.getState().notify('Plugin bundles must be JavaScript files smaller than 480 KB.', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') return;
      if (target === 'create') setCreateForm((current) => ({ ...current, entryCode: reader.result as string, bundleFileName: file.name, bundleArchiveDataUrl: '', archiveFileName: '', packageFiles: [] }));
      else setVersionForm((current) => ({ ...current, entryCode: reader.result as string, bundleFileName: file.name, bundleArchiveDataUrl: '', archiveFileName: '', hasBundleArchive: false, packageFiles: [] }));
    };
    reader.onerror = () => useLoggerStore.getState().notify('We could not read that plugin bundle.', 'error');
    reader.readAsText(file);
  };

  const handlePackageFile = async (file: File, target: 'create' | 'version') => {
    if (!file) return;
    if (file.size > 2_000_000 || !file.name.toLowerCase().endsWith('.zip')) {
      useLoggerStore.getState().notify('Plugin packages must be ZIP files smaller than 2 MB.', 'error');
      return;
    }
    setPackageLoadingTarget(target);
    try {
      const [entries, archiveDataUrl] = await Promise.all([readZipArchive(file), readFileAsDataUrl(file)]);
      const manifestEntry = findZipEntry(entries, 'manifest.json');
      if (!manifestEntry) throw new Error('The ZIP package must include manifest.json.');
      const manifest = parseManifest(zipEntryText(manifestEntry));
      const declaredEntry = typeof manifest.entry === 'string' ? manifest.entry : '';
      const entry = (declaredEntry ? findZipEntry(entries, declaredEntry) : undefined)
        ?? findZipEntry(entries, 'index.js')
        ?? findZipEntry(entries, 'index.mjs');
      if (!entry) throw new Error('The ZIP package must include index.js or index.mjs.');
      const entryCode = createBrowserModuleBundle(entries, entry.name);
      if (entryCode.length > 500_000) throw new Error('The packaged JavaScript must be smaller than 500 KB.');
      const packageFiles = entries.map((item) => ({ name: item.name, size: item.size }));
      const manifestText = JSON.stringify(manifest, null, 2);
      const manifestId = typeof manifest.id === 'string' ? manifest.id : '';
      const manifestName = typeof manifest.name === 'string' ? manifest.name : '';
      const manifestDescription = typeof manifest.description === 'string' ? manifest.description : '';
      const manifestVersion = typeof manifest.version === 'string' ? manifest.version : '';
      if (target === 'create') {
        setCreateForm((current) => ({
          ...current,
          pluginId: manifestId || current.pluginId,
          name: manifestName || current.name,
          description: manifestDescription || current.description,
          version: manifestVersion || current.version,
          manifest: manifestText,
          manifestFileName: manifestEntry.name,
          entryCode,
          bundleFileName: entry.name,
          bundleArchiveDataUrl: archiveDataUrl,
          archiveFileName: file.name,
          packageFiles,
        }));
      } else {
        setVersionForm((current) => ({
          ...current,
          version: manifestVersion || current.version,
          manifest: manifestText,
          entryCode,
          bundleFileName: entry.name,
          bundleArchiveDataUrl: archiveDataUrl,
          archiveFileName: file.name,
          hasBundleArchive: true,
          packageFiles,
        }));
      }
      useLoggerStore.getState().notify(`${file.name} loaded. Found ${packageFiles.length} files; ${manifestEntry.name} and ${entry.name} were imported.`, 'success');
    } catch (packageError) {
      useLoggerStore.getState().notify(packageError instanceof Error ? packageError.message : 'We could not read that ZIP package.', 'error', 5000);
    } finally {
      setPackageLoadingTarget(null);
    }
  };

  const handleLogoChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].includes(file.type)) {
      useLoggerStore.getState().notify('Choose a PNG, JPEG, WebP, or SVG logo.', 'error');
      return;
    }
    if (file.size > 240_000) {
      useLoggerStore.getState().notify('Logo files must be smaller than 240 KB.', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setCreateForm((current) => ({ ...current, logoDataUrl: reader.result as string }));
      }
    };
    reader.onerror = () => useLoggerStore.getState().notify('We could not read that logo file.', 'error');
    reader.readAsDataURL(file);
  };

  const renderCreateForm = () => (
    <section className="dashboard-developer-create-panel dashboard-developer-create-screen">
      <div className="dashboard-developer-form-heading">
        <div><p className="dashboard-panel-kicker">New plugin</p><strong>Start with the contract.</strong></div>
        <div className="dashboard-developer-create-actions"><button className="dashboard-link-button" type="button" onClick={useDemoPlugin}><Sparkles size={14} /> Use starter example</button><button className="dashboard-link-button" type="button" onClick={() => setCreateOpen(false)}><ArrowLeft size={14} /> Go back</button></div>
      </div>
      <form className="dashboard-developer-form" onSubmit={handleCreate}>
        <div className="dashboard-developer-two-col"><div><label htmlFor="developer-plugin-id">Plugin ID</label><input id="developer-plugin-id" value={createForm.pluginId} onChange={(event) => updateManifestFromBasics(event.target.value, createForm.name, createForm.version)} placeholder="studio.geometry" /></div><div><label htmlFor="developer-plugin-name">Name</label><input id="developer-plugin-name" value={createForm.name} onChange={(event) => updateManifestFromBasics(createForm.pluginId, event.target.value, createForm.version)} placeholder="Geometry Studio" /></div></div>
        <label htmlFor="developer-plugin-description">Description</label><textarea id="developer-plugin-description" rows={3} value={createForm.description} onChange={(event) => setCreateForm((current) => ({ ...current, description: event.target.value }))} placeholder="What does this plugin help people do?" />
        <div className="dashboard-developer-logo-field"><label htmlFor="developer-plugin-logo">Plugin logo <small>PNG, JPEG, WebP, or SVG · 240 KB max</small></label><div className="dashboard-developer-logo-row">{createForm.logoDataUrl ? <img src={createForm.logoDataUrl} alt="Plugin logo preview" /> : <span className="dashboard-developer-logo-placeholder"><Code2 size={18} /></span>}<input id="developer-plugin-logo" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={handleLogoChange} /></div></div>
        <div className="dashboard-developer-two-col"><div><label htmlFor="developer-plugin-version">First version</label><input id="developer-plugin-version" value={createForm.version} onChange={(event) => updateManifestFromBasics(createForm.pluginId, createForm.name, event.target.value)} placeholder="0.1.0" /></div><div><label htmlFor="developer-plugin-plan">Access plan</label><select id="developer-plugin-plan" value={createForm.plan} onChange={(event) => setCreateForm((current) => ({ ...current, plan: event.target.value as ManagedPluginPlan }))}><option value="free">Free</option><option value="pro">Pro</option></select></div></div>
        <PluginPackagePicker inputId="developer-plugin-package" fileName={createForm.archiveFileName} files={createForm.packageFiles} loading={packageLoadingTarget === 'create'} manualOpen={manualCreateOpen} onFile={(file) => { void handlePackageFile(file, 'create'); }} onToggleManual={() => setManualCreateOpen((current) => !current)} />
        {manualCreateOpen && <div className="dashboard-developer-upload-grid"><div><label htmlFor="developer-plugin-manifest-file">Manifest file <small>optional if editing below</small></label><input id="developer-plugin-manifest-file" type="file" accept="application/json,.json" onChange={(event) => handleManifestFileChange(event, 'create')} /><span className="dashboard-developer-upload-note">{createForm.manifestFileName || 'Choose manifest.json'}</span></div><div><label htmlFor="developer-plugin-bundle">Plugin bundle <small>JavaScript · 480 KB max</small></label><input id="developer-plugin-bundle" type="file" accept="text/javascript,.js,.mjs" onChange={(event) => handleBundleFileChange(event, 'create')} /><span className="dashboard-developer-upload-note">{createForm.bundleFileName || 'Choose index.js'}</span></div></div>}
        <label htmlFor="developer-plugin-entry-url">Bundle URL <small>optional external alternative</small></label><input id="developer-plugin-entry-url" value={createForm.entryUrl} onChange={(event) => setCreateForm((current) => ({ ...current, entryUrl: event.target.value }))} placeholder="https://…" type="url" />
        <label htmlFor="developer-plugin-manifest">Manifest JSON</label><textarea id="developer-plugin-manifest" className="dashboard-developer-manifest" rows={10} value={createForm.manifest} onChange={(event) => setCreateForm((current) => ({ ...current, manifest: event.target.value }))} />
        <label htmlFor="developer-plugin-changelog">Changelog</label><textarea id="developer-plugin-changelog" rows={2} value={createForm.changelog} onChange={(event) => setCreateForm((current) => ({ ...current, changelog: event.target.value }))} placeholder="What is included in the first release?" />
        <button className="dashboard-button dashboard-button-gold" type="submit" disabled={saving}><Plus size={15} /> {saving ? 'Creating…' : 'Create plugin draft'}</button>
      </form>
    </section>
  );

  const renderWorkspace = () => (
    <section className="dashboard-developer-workspace">
      <div className="dashboard-panel dashboard-developer-list">
        <div className="dashboard-panel-heading"><div><p className="dashboard-panel-kicker">Plugin studio</p><h3>Your plugins</h3></div><button className="dashboard-button dashboard-button-dark dashboard-developer-new" type="button" onClick={() => setCreateOpen(true)}><Plus size={15} /> New plugin</button></div>
        {loading ? <div className="dashboard-empty-state"><LoaderCircle className="is-spinning" size={20} /> Loading your plugins…</div> : plugins.length === 0 ? (
          <div className="dashboard-developer-empty"><Code2 size={24} /><strong>Your first plugin starts here.</strong><span>Create a draft with a stable ID and manifest, then send it to review when it is ready.</span><button className="dashboard-link-button" type="button" onClick={() => setCreateOpen(true)}>Create a draft <Plus size={14} /></button></div>
        ) : (
        <div className="dashboard-developer-plugin-list">{plugins.map((plugin) => <button className={`dashboard-developer-plugin-row${selectedPluginId === plugin.pluginId ? ' is-selected' : ''}`} type="button" key={plugin.pluginId} onClick={() => { setSelectedPluginId(plugin.pluginId); setVersionForm({ version: '0.2.0', manifest: JSON.stringify(plugin.versions[0]?.manifest ?? {}, null, 2), changelog: '', entryUrl: plugin.versions[0]?.entryUrl ?? '', entryCode: plugin.versions[0]?.entryCode ?? '', bundleFileName: '', bundleArchiveDataUrl: '', archiveFileName: plugin.versions[0]?.hasBundleArchive || plugin.versions[0]?.bundleArchiveDataUrl ? 'Using previous ZIP package' : '', hasBundleArchive: Boolean(plugin.versions[0]?.hasBundleArchive || plugin.versions[0]?.bundleArchiveDataUrl), packageFiles: [] }); }}><span className="dashboard-developer-plugin-mark">{(plugin.logoUrl || plugin.logoDataUrl) ? <img src={plugin.logoUrl || plugin.logoDataUrl || ''} alt="" /> : <Sparkles size={16} />}</span><span><strong>{plugin.name}</strong><small>{plugin.pluginId} · v{plugin.versions[0]?.version ?? 'draft'}</small></span><em className={`dashboard-plugin-status is-${plugin.status}`}>{statusLabel(plugin.status)}</em></button>)}</div>
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
          <form className="dashboard-developer-form" onSubmit={handleCreateVersion}>
            <div className="dashboard-developer-form-heading"><div><p className="dashboard-panel-kicker">New version</p><strong>Keep releases immutable.</strong></div><span>Latest: v{latestVersion?.version ?? '—'}</span></div>
            <label htmlFor="developer-version">Version</label>
            <input id="developer-version" value={versionForm.version} onChange={(event) => setVersionForm((current) => ({ ...current, version: event.target.value }))} placeholder="0.2.0" />
            <PluginPackagePicker inputId="developer-version-package" fileName={versionForm.archiveFileName} files={versionForm.packageFiles} loading={packageLoadingTarget === 'version'} manualOpen={manualVersionOpen} onFile={(file) => { void handlePackageFile(file, 'version'); }} onToggleManual={() => setManualVersionOpen((current) => !current)} />
            {manualVersionOpen && <div className="dashboard-developer-upload-grid"><div><label htmlFor="developer-version-manifest-file">Manifest file <small>optional if editing below</small></label><input id="developer-version-manifest-file" type="file" accept="application/json,.json" onChange={(event) => handleManifestFileChange(event, 'version')} /><span className="dashboard-developer-upload-note">{versionForm.manifest ? 'Choose another manifest.json' : 'Choose manifest.json'}</span></div><div><label htmlFor="developer-version-bundle">Plugin bundle <small>JavaScript · 480 KB max</small></label><input id="developer-version-bundle" type="file" accept="text/javascript,.js,.mjs" onChange={(event) => handleBundleFileChange(event, 'version')} /><span className="dashboard-developer-upload-note">{versionForm.bundleFileName || (versionForm.entryCode ? 'Using previous bundle' : 'Choose index.js')}</span></div></div>}
            <label htmlFor="developer-entry-url">Bundle URL <small>optional external alternative</small></label>
            <input id="developer-entry-url" value={versionForm.entryUrl} onChange={(event) => setVersionForm((current) => ({ ...current, entryUrl: event.target.value }))} placeholder="https://…" type="url" />
            <label htmlFor="developer-changelog">Changelog</label>
            <textarea id="developer-changelog" rows={2} value={versionForm.changelog} onChange={(event) => setVersionForm((current) => ({ ...current, changelog: event.target.value }))} placeholder="What changed in this version?" />
            <label htmlFor="developer-manifest">Manifest JSON</label>
            <textarea id="developer-manifest" className="dashboard-developer-manifest" rows={9} value={versionForm.manifest} onChange={(event) => setVersionForm((current) => ({ ...current, manifest: event.target.value }))} />
            <div className="dashboard-developer-actions"><button className="dashboard-button dashboard-button-dark" type="submit" disabled={saving}><GitBranch size={15} /> {saving ? 'Saving…' : 'Add version'}</button>{['draft', 'rejected'].includes(selectedPlugin.status) && <button className="dashboard-button dashboard-button-gold" type="button" disabled={saving} onClick={() => { void handleSubmit(); }}><Send size={15} /> Submit for review</button>}</div>
          </form>
        </> : <div className="dashboard-developer-detail-empty"><FileJson size={30} /><h3>Select a plugin</h3><p>Create a plugin draft or select one from the list to manage versions and submissions.</p></div>}
      </div>
    </section>
  );

  return (
    <div className="dashboard-developer">
      <section className="dashboard-section-intro"><div><p className="dashboard-kicker"><span /> Developer workspace / 04</p><h2>Build the next<br /><em>useful tool.</em></h2></div><p>Create plugin drafts, ship versioned manifests, and send finished work to the Chalkboard review queue.</p></section>
      <section className="dashboard-developer-summary" aria-label="Plugin workspace summary"><article><span>My plugins</span><strong>{plugins.length.toString().padStart(2, '0')}</strong><small>owned by you</small></article><article><span>In review</span><strong>{plugins.filter((plugin) => plugin.status === 'in_review').length.toString().padStart(2, '0')}</strong><small>waiting for a decision</small></article><article><span>Runtime plugins</span><strong>{installedPlugins.length.toString().padStart(2, '0')}</strong><small>bundled in Chalkboard</small></article></section>
      {createOpen ? renderCreateForm() : renderWorkspace()}
      {!createOpen && <section className="dashboard-developer-catalogue"><div className="dashboard-developer-catalogue-heading"><div><p className="dashboard-panel-kicker">Chalkboard catalogue</p><h3>Published plugins</h3></div><span>Available after admin approval</span></div>{catalogue.length === 0 ? <p className="dashboard-developer-catalogue-empty">No published community plugins yet. Your approved plugin will appear here.</p> : <div className="dashboard-developer-catalogue-grid">{catalogue.map((plugin) => { const logoUrl = getManagedPluginLogo(plugin); return <article key={plugin.pluginId}>{logoUrl ? <img src={logoUrl} alt="" /> : <span className="dashboard-developer-catalogue-mark"><Sparkles size={17} /></span>}<div><strong>{plugin.name}</strong><small>{plugin.pluginId} · v{plugin.currentVersion || plugin.versions[0]?.version || '—'}</small></div><em className={`dashboard-plugin-status is-${plugin.status}`}>{plugin.plan === 'pro' ? 'Pro' : 'Free'}</em></article>; })}</div>}</section>}
    </div>
  );
}
