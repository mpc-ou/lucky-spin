import { useEffect, useMemo, useState } from 'react'
import { AdditiveBlending, CanvasTexture, Color, MeshBasicMaterial, SRGBColorSpace, Texture, TextureLoader, VideoTexture } from 'three'
import { useStageConfig } from '../store/useStageConfig'
import { useMedia } from '../lib/mediaStore'

/** Average colour of an image (for the halo and floor spill). */
function averageColor(img: CanvasImageSource): Color {
  const c = document.createElement('canvas')
  c.width = c.height = 8
  const g = c.getContext('2d')!
  g.drawImage(img, 0, 0, 8, 8)
  const d = g.getImageData(0, 0, 8, 8).data
  let r = 0
  let gg = 0
  let b = 0
  for (let i = 0; i < d.length; i += 4) {
    r += d[i]
    gg += d[i + 1]
    b += d[i + 2]
  }
  const n = d.length / 4
  return new Color().setRGB(r / n / 255, gg / n / 255, b / n / 255, SRGBColorSpace)
}

/** Soft gradient: radial (halo around the wall) or linear (light spill fading across the floor). */
function gradientTexture(kind: 'radial' | 'linear') {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  const grd = kind === 'radial' ? g.createRadialGradient(64, 64, 20, 64, 64, 64) : g.createLinearGradient(0, 0, 0, 128)
  grd.addColorStop(0, 'rgba(255,255,255,1)')
  grd.addColorStop(kind === 'radial' ? 0.45 : 0.3, 'rgba(255,255,255,0.35)')
  grd.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, 128, 128)
  return new CanvasTexture(c)
}

/**
 * The wall behind the stage. With no image it is a near-black wall. With `backstage.image`
 * (public/stage-config.json, or an upload) it is an LED video wall: the picture glows (highlights go
 * past 1.0 so bloom catches them), a fine LED dot grid shows up close and fades out at a distance,
 * a soft halo surrounds the screen and a little of its colour spills on the floor.
 * Still unlit MeshBasic + two transparent quads: no real lights.
 */
export function Backstage() {
  const base = useStageConfig((s) => s.backstage)
  // an image or video uploaded in Settings (IndexedDB) replaces the configured one
  const uploaded = useMedia((s) => s.backstageUrl)
  const isVideoUpload = useMedia((s) => s.backstageType === 'video')
  const cfg = useMemo(() => (uploaded ? { ...base, image: uploaded } : base), [base, uploaded])
  const [tex, setTex] = useState<Texture | null>(null)
  const [glowColor, setGlowColor] = useState<Color>(new Color(0, 0, 0))

  useEffect(() => {
    if (!cfg.image) {
      setTex(null)
      setGlowColor(new Color(0, 0, 0))
      return
    }

    const isVideo = isVideoUpload || /\.(mp4|webm|ogg|mov)(\?.*)?$/i.test(cfg.image)
    let alive = true

    if (isVideo) {
      const video = document.createElement('video')
      video.src = cfg.image
      video.crossOrigin = 'anonymous'
      video.loop = true
      video.muted = true
      video.defaultMuted = true
      video.volume = 0
      video.playsInline = true
      video.autoplay = true
      video.setAttribute('muted', '')
      video.setAttribute('playsinline', '')
      video.setAttribute('webkit-playsinline', '')

      const vTex = new VideoTexture(video)
      vTex.colorSpace = SRGBColorSpace
      vTex.anisotropy = 4

      let timer: number | undefined
      const updateGlow = () => {
        if (!alive || !video.videoWidth) return
        try {
          setGlowColor(averageColor(video))
        } catch {
          // ignore CORS / sampling issues
        }
      }

      const onLoaded = () => {
        if (!alive) return
        setTex(vTex)
        updateGlow()
        timer = window.setInterval(updateGlow, 1500)
      }

      video.addEventListener('loadeddata', onLoaded, { once: true })
      video.play().catch(() => {
        const onFirstClick = () => {
          video.play().catch(() => {})
          window.removeEventListener('pointerdown', onFirstClick)
        }
        window.addEventListener('pointerdown', onFirstClick, { once: true })
      })

      return () => {
        alive = false
        if (timer) clearInterval(timer)
        video.pause()
        video.removeAttribute('src')
        video.load()
        vTex.dispose()
      }
    }

    const loader = new TextureLoader()
    const t = loader.load(
      cfg.image,
      (loadedTex) => {
        if (!alive) return loadedTex.dispose()
        loadedTex.colorSpace = SRGBColorSpace
        loadedTex.anisotropy = 4
        setTex(loadedTex)
        if (loadedTex.image) {
          try {
            setGlowColor(averageColor(loadedTex.image as CanvasImageSource))
          } catch {
            setGlowColor(new Color(0, 0, 0))
          }
        }
      },
      undefined,
      () => console.warn('[backstage] could not load', cfg.image),
    )
    return () => {
      alive = false
      t.dispose()
    }
  }, [cfg.image, isVideoUpload])

  const led = cfg.led

  const mat = useMemo(() => {
    const m = new MeshBasicMaterial({ color: new Color('#0c0a0b') })
    if (!tex) return m
    m.map = tex
    m.color = new Color(cfg.tint).multiplyScalar(cfg.brightness * (1 + led.glow * 0.9))
    // "cover": crop the image/video to the wall's aspect instead of stretching it
    const img = tex.image as { width?: number; height?: number; videoWidth?: number; videoHeight?: number } | undefined
    const w = img?.videoWidth || img?.width
    const h = img?.videoHeight || img?.height
    if (cfg.fit === 'cover' && w && h) {
      const wallAspect = cfg.width / cfg.height
      const imgAspect = w / h
      if (imgAspect > wallAspect) {
        tex.repeat.set(wallAspect / imgAspect, 1)
        tex.offset.set((1 - tex.repeat.x) / 2, 0)
      } else {
        tex.repeat.set(1, imgAspect / wallAspect)
        tex.offset.set(0, (1 - tex.repeat.y) / 2)
      }
    }
    if (led.glow > 0 || led.grid > 0) {
      // emissive screen: skip tone mapping so the brightest pixels can bloom
      m.toneMapped = false
      m.onBeforeCompile = (sh) => {
        sh.uniforms.uGrid = { value: [cfg.width * led.pitch, cfg.height * led.pitch] }
        sh.uniforms.uGridAmt = { value: led.grid }
        sh.uniforms.uGlow = { value: led.glow }
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vWallUv;').replace('#include <uv_vertex>', '#include <uv_vertex>\nvWallUv = uv;')
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying vec2 vWallUv;\nuniform vec2 uGrid;\nuniform float uGridAmt;\nuniform float uGlow;')
          .replace(
            '#include <map_fragment>',
            `#include <map_fragment>
            // LED dots, faded out where a dot is smaller than ~2 px (no moiré from the audience)
            vec2 cell = vWallUv * uGrid;
            vec2 g = fract(cell) - 0.5;
            float dotMask = smoothstep(0.5, 0.28, length(g));
            float tiny = smoothstep(0.25, 0.5, max(fwidth(cell.x), fwidth(cell.y)));
            diffuseColor.rgb *= mix(1.0, 0.45 + 0.75 * dotMask, uGridAmt * (1.0 - tiny));
            // highlights push past 1.0 so the bloom pass gives them a soft glow
            float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
            diffuseColor.rgb += diffuseColor.rgb * smoothstep(0.35, 0.9, lum) * uGlow * 1.6;`,
          )
      }
      m.customProgramCacheKey = () => `led-${led.grid > 0}`
    }
    return m
  }, [tex, cfg.tint, cfg.brightness, cfg.fit, cfg.width, cfg.height, led.glow, led.grid, led.pitch])

  const halo = useMemo(() => new MeshBasicMaterial({ map: gradientTexture('radial'), blending: AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false }), [])
  const spill = useMemo(() => new MeshBasicMaterial({ map: gradientTexture('linear'), blending: AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false }), [])
  halo.color.copy(glowColor).multiplyScalar(0.55 * led.glow)
  spill.color.copy(glowColor).multiplyScalar(0.35 * led.glow)
  const lit = !!tex && led.glow > 0
  const [x, y, z] = cfg.position

  return (
    <>
      <mesh position={cfg.position} material={mat} raycast={() => null}>
        <planeGeometry args={[cfg.width, cfg.height]} />
      </mesh>
      {lit && (
        <>
          {/* soft halo bleeding past the screen edges */}
          <mesh position={[x, y, z - 0.02]} material={halo} raycast={() => null} renderOrder={-1}>
            <planeGeometry args={[cfg.width * 1.35, cfg.height * 1.45]} />
          </mesh>
          {/* light spill on the floor in front of the screen */}
          <mesh position={[x, 0.003, z + 1.2]} rotation={[-Math.PI / 2, 0, 0]} material={spill} raycast={() => null}>
            <planeGeometry args={[cfg.width * 0.95, 2.4]} />
          </mesh>
        </>
      )}
    </>
  )
}
