import { Download, Upload, Trash2, MoveUpRight, Plus, Power } from 'lucide-react';
import { useRef } from 'react';
import { COMMAND_LABELS, type GestureTemplate } from '../core/types';
import { previewPaths } from '../vision/drawing';
import { parseProfile } from '../core/storage';

export function GestureLibrary({
  gestures,
  onChange,
  onCreate,
  onNotice,
}: {
  gestures: GestureTemplate[];
  onChange: (g: GestureTemplate[]) => void;
  onCreate: () => void;
  onNotice: (m: string) => void;
}) {
  const file = useRef<HTMLInputElement>(null);
  function exportProfile() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify({ version: 1, gestures }, null, 2)], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = 'GestureDeck-profile.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function importProfile(f: File) {
    try {
      if (f.size > 2_000_000) throw new Error('Profile files must be 2 MB or smaller.');
      const imported = parseProfile(await f.text());
      const map = new Map(gestures.map((g) => [g.id, g]));
      for (const g of imported) map.set(g.id, g);
      const all = [...map.values()];
      if (all.length > 30) throw new Error('The merged profile would exceed 30 poses.');
      onChange(all);
      onNotice(`Imported ${imported.length} poses. Check them in Test Lab.`);
    } catch (e) {
      onNotice((e as Error).message);
    }
  }
  return (
    <section className="library-section">
      <div className="library-heading">
        <div>
          <h2>
            My poses <span>{gestures.length.toString().padStart(2, '0')}</span>
          </h2>
          <p>
            Saved in this browser. Export a profile to back up your poses or move to another device.
          </p>
        </div>
        <div className="toolbar-actions">
          <button className="button secondary compact" onClick={() => file.current?.click()}>
            <Upload size={15} />
            Import
          </button>
          <button
            className="button secondary compact"
            disabled={!gestures.length}
            onClick={exportProfile}
          >
            <Download size={15} />
            Export
          </button>
          <input
            type="file"
            ref={file}
            hidden
            accept="application/json,.json"
            onChange={(e) => {
              if (e.target.files?.[0]) void importProfile(e.target.files[0]);
              e.target.value = '';
            }}
          />
        </div>
      </div>
      <div className="gesture-grid">
        {gestures.map((g, i) => (
          <div className={`card gesture-card ${g.enabled ? '' : 'disabled'}`} key={g.id}>
            <div className="gesture-top">
              <span className="gesture-index">{(i + 1).toString().padStart(2, '0')}</span>
              <button
                className="icon-button"
                title={g.enabled ? 'Disable pose' : 'Enable pose'}
                aria-label={`${g.enabled ? 'Disable' : 'Enable'} ${g.name}`}
                onClick={() =>
                  onChange(gestures.map((x) => (x.id === g.id ? { ...x, enabled: !x.enabled } : x)))
                }
              >
                <Power size={16} />
              </button>
            </div>
            <svg viewBox="0 0 160 100" className="gesture-path" aria-label="Saved wrist position">
              <path d="M15 70H145M80 10V90" stroke="#e6ebe1" strokeDasharray="3 4" />
              {previewPaths(g.samples[0]).map((d, j) => (
                <path
                  key={j}
                  d={d}
                  fill="none"
                  stroke={j ? '#d68c58' : '#507d67'}
                  strokeWidth="3"
                  strokeLinecap="round"
                />
              ))}
            </svg>
            <h3>{g.name}</h3>
            <div className="gesture-action">
              <span>{COMMAND_LABELS[g.command]}</span>
              <MoveUpRight size={15} />
            </div>
            <div className="gesture-bottom">
              <small>
                {(g.cooldownMs / 1000).toFixed(1)}s cooldown ·{' '}
                {g.mode === 'pose' ? 'single pose' : 'legacy motion'}
              </small>
              <button
                className="icon-button"
                aria-label={`Delete ${g.name}`}
                title="Delete pose"
                onClick={() => {
                  if (
                    window.confirm(
                      `Delete "${g.name}"? Export a profile first if you want a backup.`,
                    )
                  )
                    onChange(gestures.filter((x) => x.id !== g.id));
                }}
              >
                <Trash2 size={15} />
              </button>
            </div>
          </div>
        ))}
        <button className="new-gesture-card" onClick={onCreate}>
          <span>
            <Plus size={26} />
          </span>
          <strong>Create a pose</strong>
          <small>Capture once and hold still</small>
        </button>
      </div>
    </section>
  );
}
