import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useGameStore } from '../store/useGameStore'
import { useMedia } from '../lib/mediaStore'
import { useStageConfig } from '../store/useStageConfig'
import { assetUrl } from '../lib/assetUrl'
import { Upload } from './SettingsPanel'
import { ModelPacks } from './ModelPacks'
import { GpuCheck } from './GpuCheck'
import { audio } from '../audio/audioManager'

const CharacterPreview = lazy(() => import('./CharacterPreview'))

const KEY = 'lucky-spin:onboarded'

function seen() {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return true // storage blocked: never nag
  }
}

const STEPS = [
  { title: 'Welcome to Lucky Spin', body: 'A few quick steps to make the stage yours: graphics check, background, host and music. Skip at any time.' },
  { title: 'Graphics check', body: 'The show runs on your graphics card. If something below is red, follow the steps, then reload.' },
  { title: 'Stage background', body: 'The picture hanging behind the stage (logo, event banner). A landscape image around 1920 × 1080 looks best.' },
  { title: 'Host', body: 'Pick who carries the ballot box and runs the draw. Have your own model pack (.zip)? Upload it here.' },
  { title: 'Background music', body: 'Plays on a loop during the whole show. Leave it empty to keep the default music.' },
  { title: 'All set!', body: 'Everything can be changed later in Settings: the Settings button on the home screen, ⚙ in the bottom-right corner (hover to show), or click the radio on stage.' },
]

/** Background step: the current backdrop (upload, stage-config image or the default). */
function BackgroundPreview() {
  const uploaded = useMedia((s) => s.backstageUrl)
  const isVideo = useMedia((s) => s.backstageType === 'video')
  const configured = useStageConfig((s) => s.backstage.image)
  const src = uploaded ?? assetUrl(configured ?? 'backstage.jpg')
  const video = isVideo || /\.(mp4|webm|ogg|mov)(\?.*)?$/i.test(src)
  return (
    <div className="flex flex-col gap-2">
      <div className="aspect-video w-full overflow-hidden rounded-sm border border-brass/30 bg-black">
        {video ? (
          <video src={src} autoPlay loop muted playsInline className="h-full w-full object-cover" />
        ) : (
          <img src={src} alt="Stage background" className="h-full w-full object-cover" onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')} />
        )}
      </div>
      <Upload kind="backstage" label="Background" accept="image/*,video/mp4,video/webm,video/quicktime,video/*" />
    </div>
  )
}

/** Music step: play / pause the current track (upload or the default). */
function MusicPreview() {
  const uploaded = useMedia((s) => s.musicUrl)
  const name = useMedia((s) => s.musicName)
  const el = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const src = uploaded ?? assetUrl('audio/music.mp3')
  useEffect(() => {
    setPlaying(false)
    el.current?.pause()
  }, [src])
  useEffect(() => () => el.current?.pause(), [])
  const toggle = () => {
    const a = el.current
    if (!a) return
    if (a.paused) void a.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
    else {
      a.pause()
      setPlaying(false)
    }
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 rounded-sm border border-brass/30 bg-black/40 px-3 py-2">
        <button onClick={toggle} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-brass-hi/70 text-brass-hi hover:bg-brass/20" aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? '❚❚' : '▶'}
        </button>
        <div className="min-w-0 text-[13px]">
          <div className="truncate text-paper">{name ?? 'Default music'}</div>
          <div className="text-[11px] text-muted">{playing ? 'Playing preview…' : 'Press play to listen'}</div>
        </div>
        <audio ref={el} src={src} loop onEnded={() => setPlaying(false)} />
      </div>
      <Upload kind="music" label="Music" accept="audio/*" />
    </div>
  )
}

/** Host step: dropdown + a small low-resolution 3D preview of the chosen character. */
function HostPreview() {
  return (
    <div className="flex flex-col gap-3">
      <div className="relative h-56 overflow-hidden rounded-sm border border-brass/30 bg-[radial-gradient(ellipse_at_50%_35%,rgba(184,137,59,0.18),transparent_65%)]">
        <Suspense fallback={<div className="flex h-full items-center justify-center text-[12px] text-muted">Loading preview…</div>}>
          <CharacterPreview low />
        </Suspense>
      </div>
      <ModelPacks hint={false} />
    </div>
  )
}

/** First visit only (remembered in localStorage): a short setup walkthrough, skippable at every step. */
export function Onboarding() {
  const ready = useGameStore((s) => s.sceneReady)
  const [open, setOpen] = useState(() => !seen())
  const [step, setStep] = useState(0)
  if (!open || !ready) return null

  const finish = () => {
    try {
      localStorage.setItem(KEY, '1')
    } catch {
      /* ignore */
    }
    setOpen(false)
  }
  const next = () => {
    void audio.unlock()
    audio.play('tick', { vol: 0.4 })
    if (step === STEPS.length - 1) finish()
    else setStep(step + 1)
  }
  const s = STEPS[step]
  const last = step === STEPS.length - 1

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-[2px]">
      <div className="scroll-thin max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-md border border-brass/50 bg-ink/95 p-6 shadow-[0_20px_80px_rgba(0,0,0,0.7)]">
        <div className="mb-4 flex items-center gap-1.5">
          {STEPS.map((_, i) => (
            <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${i <= step ? 'bg-brass-hi' : 'bg-brass/20'}`} />
          ))}
        </div>
        <h2 className="font-serif text-2xl tracking-[0.08em] text-paper">{s.title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-paper/75">{s.body}</p>

        <div className="mt-5">
          {step === 1 && <GpuCheck />}
          {step === 2 && <BackgroundPreview />}
          {step === 3 && <HostPreview />}
          {step === 4 && <MusicPreview />}
        </div>

        <div className="mt-6 flex items-center justify-between">
          {!last ? (
            <button className="text-[12px] tracking-wide text-muted hover:text-paper" onClick={finish}>
              Skip
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            {step > 0 && !last && (
              <button className="rounded-sm border border-brass/40 px-4 py-2 text-[12px] tracking-[0.15em] uppercase hover:border-brass-hi" onClick={() => setStep(step - 1)}>
                Back
              </button>
            )}
            <button
              className="rounded-sm border border-brass-hi/70 bg-gradient-to-b from-[#d6a955] to-[#8a6223] px-5 py-2 text-[12px] font-semibold tracking-[0.2em] text-ink uppercase"
              onClick={next}
            >
              {last ? 'Start' : step === 0 ? 'Set up' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
