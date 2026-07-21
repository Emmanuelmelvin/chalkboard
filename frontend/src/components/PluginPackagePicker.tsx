import { useRef, useState, type DragEvent } from 'react';
import { FileArchive, FileCode2, FileJson, FolderOpen, UploadCloud } from 'lucide-react';

export interface PluginPackageFile {
  name: string;
  size: number;
}

interface PluginPackagePickerProps {
  inputId: string;
  fileName: string;
  files: PluginPackageFile[];
  loading?: boolean;
  manualOpen: boolean;
  onFile: (file: File) => void;
  onToggleManual: () => void;
}

function formatSize(size: number) {
  if (size < 1_024) return `${size} B`;
  return `${(size / 1_024).toFixed(size < 10_240 ? 1 : 0)} KB`;
}

function iconForFile(name: string) {
  if (name.toLowerCase().endsWith('.json')) return <FileJson size={13} />;
  if (/\.(?:js|mjs|ts|tsx)$/i.test(name)) return <FileCode2 size={13} />;
  return <FileArchive size={13} />;
}

export default function PluginPackagePicker({
  inputId,
  fileName,
  files,
  loading = false,
  manualOpen,
  onFile,
  onToggleManual,
}: PluginPackagePickerProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);

  const acceptFile = (file: File | undefined) => {
    if (file) onFile(file);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    acceptFile(event.dataTransfer.files[0]);
  };

  return (
    <div className="dashboard-developer-package-field">
      <div className="dashboard-developer-package-heading">
        <label htmlFor={inputId}>Plugin package <small>ZIP · 2 MB max</small></label>
        <button className="dashboard-link-button" type="button" onClick={onToggleManual}>
          <FolderOpen size={13} /> {manualOpen ? 'Hide manual files' : 'Add files manually'}
        </button>
      </div>
      <div
        className={`dashboard-developer-package-dropzone${dragging ? ' is-dragging' : ''}${fileName ? ' has-file' : ''}`}
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click();
        }}
        onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }}
        onDrop={handleDrop}
      >
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept=".zip,application/zip,application/x-zip-compressed"
          onChange={(event) => { acceptFile(event.target.files?.[0]); event.currentTarget.value = ''; }}
        />
        <UploadCloud size={20} />
        <strong>{loading ? 'Reading package…' : fileName || 'Drop ZIP package here'}</strong>
        <span>{loading ? 'Inspecting manifest and entry files' : 'or click to browse'}</span>
      </div>
      {files.length > 0 && (
        <div className="dashboard-developer-package-files">
          <div><strong>{files.length} package file{files.length === 1 ? '' : 's'}</strong><small>manifest.json and index.js are detected automatically</small></div>
          <ul>
            {files.slice(0, 6).map((file) => <li key={file.name}>{iconForFile(file.name)}<span>{file.name}</span><small>{formatSize(file.size)}</small></li>)}
            {files.length > 6 && <li className="is-more">+ {files.length - 6} more files</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
