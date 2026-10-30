import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Color, DoubleSide, InstancedMesh, Matrix4, MeshStandardMaterial, PlaneGeometry, Quaternion, Vector3 } from 'three'
import { useQuality } from '../../quality/qualityPresets'
import { clock } from '../../director/channels'

const MAX = 1600
const PALETTE = ['#F2D28A', '#C9A24A', '#E8E8EE', '#FF3B5C', '#F2D28A', '#B8893B', '#FFFFFF', '#E04DFF'].map((c) => new Color(c))

interface P {
  p: Vector3
  v: Vector3
  axis: Vector3
  spin: number
  angle: number
  life: number
  phase: number
  alive: boolean
}

/** Pool of metallic paper chips (one InstancedMesh). `confetti.burst()` recycles chips — nothing is allocated at runtime. */
export const confetti = {
  queue: [] as { origin: Vector3; n: number; spread: number; box?: Vector3; up?: number }[],
  burst(origin: Vector3, n = 300, spread = 1.6, box?: Vector3, up = 2.2) {
    this.queue.push({ origin: origin.clone(), n, spread, box: box?.clone(), up })
  },
}

const _m = new Matrix4()
const _q = new Quaternion()
const _s = new Vector3()

export function Confetti() {
  const budget = useQuality().confetti
  const mesh = useRef<InstancedMesh>(null)
  const parts = useMemo<P[]>(
    () =>
      Array.from({ length: MAX }, () => ({
        p: new Vector3(0, -10, 0),
        v: new Vector3(),
        axis: new Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(),
        spin: 4 + Math.random() * 8,
        angle: Math.random() * 6,
        life: 0,
        phase: Math.random() * 6.28,
        alive: false,
      })),
    [],
  )
  const geo = useMemo(() => new PlaneGeometry(0.022, 0.034), [])
  const mat = useMemo(() => new MeshStandardMaterial({ metalness: 0.85, roughness: 0.3, side: DoubleSide, emissive: new Color('#3a2a10'), emissiveIntensity: 0.2 }), [])

  useFrame((_, dtRaw) => {
    const m = mesh.current
    if (!m) return
    const dt = Math.min(dtRaw, 0.05) * clock.speed
    // spawn
    while (confetti.queue.length) {
      const b = confetti.queue.shift()!
      let spawned = 0
      const box = b.box ?? _s.set(0.3, 0.2, 0.3)
      const up = b.up ?? 2.2
      for (let i = 0; i < Math.min(MAX, budget) && spawned < Math.min(b.n, budget); i++) {
        const c = parts[i]
        if (c.alive) continue
        c.alive = true
        c.life = 0
        c.p.copy(b.origin).add(_s.set((Math.random() - 0.5) * box.x, Math.random() * box.y, (Math.random() - 0.5) * box.z))
        const a = Math.random() * Math.PI * 2
        const sp = Math.random() * b.spread
        c.v.set(Math.cos(a) * sp, up + Math.random() * 2.2, Math.sin(a) * sp * 0.6)
        m.setColorAt(i, PALETTE[i % PALETTE.length])
        spawned++
      }
      if (m.instanceColor) m.instanceColor.needsUpdate = true
    }
    for (let i = 0; i < MAX; i++) {
      const c = parts[i]
      if (!c.alive || i >= budget) {
        m.setMatrixAt(i, _m.makeScale(0, 0, 0))
        continue
      }
      c.life += dt
      // drag toward a slow terminal fall, flutter sideways like paper
      c.v.y += -3.2 * dt
      c.v.multiplyScalar(1 - Math.min(1, 1.8 * dt))
      if (c.v.y < -0.48) c.v.y = -0.48
      c.p.addScaledVector(c.v, dt)
      c.p.x += Math.sin(c.life * 2.8 + c.phase) * 0.35 * dt
      c.p.z += Math.cos(c.life * 2.1 + c.phase) * 0.28 * dt
      let scale = 1
      if (c.p.y <= 0.004) {
        c.p.y = 0.004
        c.v.set(0, 0, 0)
        scale = Math.max(0, 1 - (c.life - 6) / 3)
        if (scale <= 0) c.alive = false
      } else c.angle += c.spin * dt
      _q.setFromAxisAngle(c.axis, c.angle)
      m.setMatrixAt(i, _m.compose(c.p, _q, _s.setScalar(scale)))
    }
    m.instanceMatrix.needsUpdate = true
  })

  return <instancedMesh ref={mesh} args={[geo, mat, MAX]} frustumCulled={false} castShadow={false} />
}
