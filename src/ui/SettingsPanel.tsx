import { useGameStore } from '../store/useGameStore'
import { useRef, useState } from 'react'
import { useMedia, saveMedia, clearMedia, type MediaKind } from '../lib/mediaStore'
import { useSettingsStore, type QualityChoice } from '../store/useSettingsStore'
import { useQuality, type QualityPreset } from '../quality/qualityPresets'
import { director } from '../director/Director'
import { audio } from '../audio/audioManager'
import { ModelPacks } from './ModelPacks'
import { GpuCheck } from './GpuCheck'

const QUALITY: { k: QualityChoice; label: string }[] = [
  { k: 'auto', label: 'Auto' },
  { k: 'low', label: 'Low' },
  { k: 'medium', label: 'Med' },
  { k: 'high', label: 'High' },
  { k: 'ultra', label: 'Ultra' },
]
const LEVEL_LABEL = { low: 'Low', medium: 'Medium', high: 'High', ultra: 'Ultra' } as const

/** Sound + graphics settings. Opened from the ⚙ button or by tapping the radio on stage. */
export function SettingsPanel() {
  const open = useGameStore((s) => s.settingsOpen)
  const st = useSettingsStore()
  if (!open) return null
  const close = () => director.closeSettings()
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-end p-4 sm:items-center sm:justify-center" onPointerDown={close}>
      <div
        className="scroll-thin max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-md border border-brass/50 bg-ink/90 p-6 shadow-[0_20px_80px_rgba(0,0,0,0.7)] backdrop-blur-sm"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-serif text-xl tracking-[0.15em]">Settings</h2>
          <button className="text-xl leading-none text-muted hover:text-paper" aria-label="Close" onClick={close}>
            ×
          </button>
        </div>

        <Section title="Sound">
          <Slider label="Master" value={st.master} onChange={(v) => st.set({ master: v })} />
          <Slider label="Music" value={st.music} onChange={(v) => st.set({ music: v })} />
          <Slider label="Effects" value={st.sfx} onChange={(v) => st.set({ sfx: v })} />
          <Toggle label="Mute" on={st.muted} onChange={() => st.set({ muted: !st.muted })} />
        </Section>

        <Section title="Stage & music">
          <Upload kind="backstage" label="Background" accept="image/*,video/mp4,video/webm,video/quicktime,video/*" />
          <Upload kind="music" label="Music" accept="audio/*" />
          <div className="text-[11px] leading-relaxed text-muted">Saved in this browser. A new upload replaces the old file.</div>
        </Section>

        <Section title="Character">
          <ModelPacks />
        </Section>

        <Section title="Graphics card">
          <GpuCheck />
        </Section>

        <Section title="Graphics">
          <div className="grid grid-cols-5 gap-1">
            {QUALITY.map((q) => (
              <button
                key={q.k}
                onClick={() => {
                  st.set({ quality: q.k })
                  audio.play('tick', { vol: 0.4 })
                }}
                className={`rounded-sm border px-1 py-2 text-[11px] tracking-wide transition-colors ${
                  st.quality === q.k ? 'border-brass-hi bg-brass/70 text-ink' : 'border-brass/30 text-paper/80 hover:border-brass-hi'
                }`}
              >
                {q.label}
              </button>
            ))}
          </div>
          <div className="mt-2 text-[11px] text-muted">
            Rendering: {LEVEL_LABEL[st.level]}
            {st.quality === 'auto' ? ' (adapts to this machine)' : ''}
          </div>
        </Section>

        <Advanced />

        <Section title="Speed">
          <Toggle label="Fast ×2 (key F)" on={st.fast} onChange={() => director.toggleFast()} />
        </Section>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5 last:mb-0">
      <div className="mb-2 text-[10px] tracking-[0.35em] text-brass uppercase">{title}</div>
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  )
}

function Slider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex items-center gap-3 text-sm">
      <span className="w-20 shrink-0 text-paper/85">{label}</span>
      <input
        type="range"
        min={0}
        max={100}
        value={Math.round(value * 100)}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        className="h-1 flex-1 cursor-pointer accent-[#b8893b]"
      />
      <span className="w-8 text-right font-mono text-xs text-muted">{Math.round(value * 100)}</span>
    </label>
  )
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={onChange} className="flex items-center justify-between text-sm text-paper/85">
      {label}
      <span className={`relative h-5 w-9 rounded-full border transition-colors ${on ? 'border-brass bg-brass/50' : 'border-muted/50'}`}>
        <span className={`absolute top-[2px] h-3.5 w-3.5 rounded-full transition-all ${on ? 'left-[18px] bg-brass-hi' : 'left-[2px] bg-muted'}`} />
      </span>
    </button>
  )
}

/**
 * Per-option overrides on top of the chosen level. Each control shows the value currently in effect;
 * changing it pins that option until "Reset to preset".
 */
function Advanced() {
  const [open, setOpen] = useState(false)
  const q = useQuality()
  const st = useSettingsStore()
  const custom = st.custom
  const put = <K extends keyof QualityPreset>(k: K, v: QualityPreset[K]) => st.set({ custom: { ...custom, [k]: v } })
  const pinned = Object.keys(custom).length
  return (
    <div className="mb-5">
      <button className="mb-2 flex w-full items-center justify-between text-[10px] tracking-[0.35em] text-brass uppercase" onClick={() => setOpen(!open)}>
        <span>
          Detailed options{pinned ? ` · ${pinned} changed` : ''}
        </span>
        <span className="text-sm">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="flex flex-col gap-3">
          <Slider label="Resolution" value={st.renderScale} onChange={(v) => st.set({ renderScale: Math.max(0.5, v) })} />
          <Choice
            label="Shadows"
            value={q.shadowSize === 0 ? 0 : q.shadowSize < 2048 ? 1 : 2}
            options={['Off', 'Low', 'High']}
            onChange={(i) => put('shadowSize', [0, 1024, 2048][i])}
          />
          <Toggle label="Real host shadow" on={q.hostShadow} onChange={() => put('hostShadow', !q.hostShadow)} />
          <Toggle label="Floor reflections" on={q.reflectorRes > 0} onChange={() => put('reflectorRes', q.reflectorRes > 0 ? 0 : 512)} />
          <Choice label="Light beams" value={['off', 'main', 'all'].indexOf(q.cones)} options={['Off', 'Main', 'All']} onChange={(i) => put('cones', (['off', 'main', 'all'] as const)[i])} />
          <Toggle label="Dust in beams" on={q.dustInCones} onChange={() => put('dustInCones', !q.dustInCones)} />
          <Choice label="Stage smoke" value={q.smoke === 0 ? 0 : q.smoke <= 12 ? 1 : 2} options={['Off', 'Light', 'Heavy']} onChange={(i) => put('smoke', [0, 10, 22][i])} />
          <Choice label="Floor fog" value={q.fogLayers === 0 ? 0 : q.fogLayers === 1 ? 1 : 2} options={['Off', '1 layer', '3 layers']} onChange={(i) => put('fogLayers', [0, 1, 3][i])} />
          <Toggle label="Bloom" on={q.bloom} onChange={() => put('bloom', !q.bloom)} />
          <Toggle label="Depth of field" on={q.dof} onChange={() => put('dof', !q.dof)} />
          <Toggle label="Chromatic aberration on pans" on={q.chroma} onChange={() => put('chroma', !q.chroma)} />
          <Toggle label="Film grain" on={q.grain} onChange={() => put('grain', !q.grain)} />
          <Toggle label="Anti-aliasing (SMAA)" on={q.antialias} onChange={() => put('antialias', !q.antialias)} />
          <Toggle label="Cage motion blur" on={q.motionBlur} onChange={() => put('motionBlur', !q.motionBlur)} />
          <Slider label="Confetti" value={q.confetti / 1600} onChange={(v) => put('confetti', Math.round(v * 1600))} />
          <button
            className="self-start text-[11px] tracking-wide text-muted underline-offset-2 hover:text-paper hover:underline disabled:opacity-40"
            disabled={!pinned && st.renderScale === 1}
            onClick={() => st.set({ custom: {}, renderScale: 1 })}
          >
            Reset to the preset
          </button>
        </div>
      )}
    </div>
  )
}

function Choice({ label, value, options, onChange }: { label: string; value: number; options: string[]; onChange: (i: number) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-paper/85">{label}</span>
      <div className="flex gap-1">
        {options.map((o, i) => (
          <button
            key={o}
            onClick={() => onChange(i)}
            className={`rounded-sm border px-2 py-1 text-[11px] ${i === value ? 'border-brass-hi bg-brass/70 text-ink' : 'border-brass/30 text-paper/80 hover:border-brass-hi'}`}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Upload slot backed by IndexedDB (one file per kind; a new upload overwrites the old one). */
export function Upload({ kind, label, accept }: { kind: MediaKind; label: string; accept: string }) {
  const input = useRef<HTMLInputElement>(null)
  const name = useMedia((s) => (kind === 'backstage' ? s.backstageName : s.musicName))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const onPick = async (f: File | undefined) => {
    if (!f) return
    setErr(null)
    if (f.size > 150 * 1024 * 1024) return setErr('File too large (150 MB max).')
    setBusy(true)
    try {
      await saveMedia(kind, f)
      audio.play('tick', { vol: 0.5 })
    } catch {
      setErr('Could not save the file.')
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }
  return (
    <div className="flex flex-col gap-1 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="shrink-0 text-paper/85">{label}</span>
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[11px] text-muted" title={name ?? ''}>
            {busy ? 'Saving…' : (name ?? 'Default')}
          </span>
          <button className="shrink-0 rounded-sm border border-brass/40 px-2 py-1 text-[11px] hover:border-brass-hi hover:text-brass-hi" onClick={() => input.current?.click()}>
            Upload
          </button>
          {name && (
            <button className="shrink-0 text-[11px] text-muted hover:text-red-300" onClick={() => void clearMedia(kind)} aria-label={`Remove ${label}`}>
              Remove
            </button>
          )}
        </div>
        <input ref={input} type="file" accept={accept} className="hidden" onChange={(e) => void onPick(e.target.files?.[0])} />
      </div>
      {err && <div className="text-[11px] text-red-300">{err}</div>}
    </div>
  )
}
