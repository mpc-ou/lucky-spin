import gsap from 'gsap'
import { Camera, Quaternion, Vector3 } from 'three'
import { useGameStore, ballsFor, shown as displayed, type Phase } from '../store/useGameStore'
import { parseEntries } from '../lib/parseEntries'
import { vrand } from '../lib/random'
import { audio } from '../audio/audioManager'
import { cage, clock, fx, lights, stage } from './channels'
import { useSettingsStore } from '../store/useSettingsStore'
import { spin } from './spin'
import { cameraDirector, camState } from './CameraDirector'
import { shotParams, shotTargets, ticketCam } from './cameraShots'
import { lightDirector } from './LightDirector'
import { ballSystem, type Ball } from '../scene/Balls/ballSystem'
import { hero } from '../scene/Balls/HeroBall'
import { ticket, TICKET_W, TICKET_H } from '../scene/Props/Ticket'
import { confetti } from '../scene/VFX/Confetti'
import { ballot, BALLOT_SIZE } from '../scene/Props/BallotBox'
import { host } from '../scene/Host/useHostAnimator'
import { PATHS } from '../scene/Host/hostPaths'
import { knobWorld } from '../scene/Cage/Crank'
import { BALL_RADIUS, CAGE, CHUTE, FLOAT_CLOUD, MARKS, OUTLET, TICKET_BOX, TRAY } from '../scene/layout'

const g = () => useGameStore.getState()
const _v = new Vector3()
const _w = new Vector3()
const _w2 = new Vector3()
// held top half: open side tilted up and toward the audience (-120° about the character's X)
const _v2 = new Vector3()
const _qBody = new Quaternion()
const _qTmp = new Quaternion()
const _qIdentity = new Quaternion()
/** box carried sideways on one palm */
const _qSide = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2)
const _qFlip = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -2.09)
const smoothClamp = (x: number) => {
  const t = Math.min(1, Math.max(0, x))
  return t * t * (3 - 2 * t)
}
const BUSY: Phase[] = ['PACKING', 'HOST_ENTER', 'LOADING_CAGE', 'SPINNING', 'DECELERATING', 'DISPENSING', 'HOST_PICKUP', 'OPENING']
const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** gsap-based wait: honours the global time scale (click-to-fast-forward). */
const wait = (s: number) => new Promise<void>((r) => gsap.delayedCall(reduced ? s * 0.5 : s, r))
const tween = (target: object, vars: gsap.TweenVars) =>
  new Promise<void>((r) => gsap.to(target, { ...vars, duration: (vars.duration as number) * (reduced ? 0.5 : 1), onComplete: r }))
/** poll a condition on the gsap ticker */
const until = (cond: () => boolean, timeout = 5) =>
  new Promise<void>((resolve) => {
    let t = 0
    const tick = () => {
      t += gsap.ticker.deltaRatio() / 60
      if (cond() || t > timeout) {
        gsap.ticker.remove(tick)
        resolve()
      }
    }
    gsap.ticker.add(tick)
  })

/**
 * Central timeline. Every phase is an async script that drives camera + lights + host + sound + VFX
 * from ONE place, awaiting the host's promises so the state machine only advances when the
 * character has actually finished (section 3 / 14).
 */
class Director {
  camera: Camera | null = null
  private heroAttached: 'R' | 'LR' | null = null
  private ticketFollowHands = false
  /** ticket held in front of / beside the host, in host-local space (the hands follow its edges) */
  private ticketHold = false
  private ticketLocal = new Vector3()
  /** top half of the split ball rides the left palm */
  private topFollowL = false
  /** the ballot box rides in the host's hands */
  private carryingBox = false
  /** how the box is held: 0 = on the left palm beside the hip, 1 = both hands in front of the belly */
  private boxGrip = { two: 0 }
  private nudge: gsap.core.Tween | null = null
  private autoOpen: gsap.core.Tween | null = null
  private omegaPeak = 10
  private ticketDown: number | null = null
  private packResolve: (() => void) | null = null
  private spunOnce = false
  /** winners drawn since "Run the draw" (for the winner limit) */
  private sessionWins = 0
  private endRequested = false
  private drawn: Ball | null = null

  // ------------------------------------------------------------- phase helper
  private phase(p: Phase) {
    const ok = g().setPhase(p)
    this.setSpeed(1)
    return ok
  }
  private setSpeed(s: number) {
    this.skipSpeed = s
    this.applySpeed()
  }
  private skipSpeed = 1
  /** effective speed = ×2 toggle × click-to-skip boost */
  applySpeed() {
    const v = (useSettingsStore.getState().fast ? 2 : 1) * this.skipSpeed
    clock.speed = v
    gsap.globalTimeline.timeScale(v)
  }
  toggleFast() {
    const st = useSettingsStore.getState()
    st.set({ fast: !st.fast })
    this.applySpeed()
    audio.play('tick', { vol: 0.5, pitch: st.fast ? 0.8 : 1.3 })
  }
  get busy() {
    return BUSY.includes(g().phase)
  }

  /** Click anywhere during a long animation = 3× speed, double-click = jump ahead (8×). */
  skip(double: boolean) {
    if (!this.busy) return
    this.setSpeed(double ? 8 : 3)
  }

  async start() {
    const s = g()
    if (s.phase !== 'EDITING') return
    this.sessionWins = 0
    this.endRequested = false
    await audio.unlock()
    audio.setLoop('music', 0.55, 2)
    audio.setLoop('room', 0.16, 1)
    const n = s.buildPool()
    if (!n) return
    const count = ballsFor(n)
    ballSystem.reset()
    hero.visible = false
    ticket.visible = false
    host.place(MARKS.wing, Math.PI / 2)
    host.idleEnabled = false
    host.setState('offstage')
    cage.angle = 0
    stage.curtainOpen = 0
    if (!this.phase('PACKING')) return
    lightDirector.cue('editing')
    const balls = ballSystem.balls.slice(0, count)
    balls.forEach((b) => {
      b.pos.set(0, -5, 0)
      b.scale = 0
      ballSystem.setMode(b, 'float')
    })
    ballot.visible = false
    ballot.lid = 0
    ballot.glow = 0
    ballot.scale = 1
    host.place(MARKS.pack, 0)
    host.carryHand = 'L'
    this.boxGrip.two = 1
    this.carryingBox = true
    ballot.visible = true
    ballot.lid = 1
    ballot.glow = 0.4
    host.setPose('carryBox')
    host.setState('idle')
    host.lookAtCamera()
    cameraDirector.setShot('packing')
    gsap.killTweensOf(lights, 'follow,foot')
    lightDirector.followOn()
    gsap.to(lights, { foot: 0.8, duration: 0.6 })
    await wait(0.9)

    // hand the DOM overlay its card → ball screen targets
    const { entries } = parseEntries(s.text)
    const pool = new Set(g().pool.map((e) => e.id))
    const shown = entries.filter((e) => pool.has(e.id)).slice(0, 200)
    const slot = this.packTarget()
    const cards = shown.map((e, i) => {
      const b = balls[i % count]
      return { text: displayed(e.cols[0] || e.raw), ball: b.i, x: slot.x + vrand(-30, 30), y: slot.y, color: `#${b.color.clone().convertLinearToSRGB().getHexString()}` }
    })
    const done = new Promise<void>((r) => (this.packResolve = r))
    g().set({ packing: { cards } })
    await Promise.race([done, wait(6)])
    g().set({ packing: null })
    // lid shut, a happy nod, then off into the wing (box on the audience-side hand) as the curtain rises
    await tween(ballot, { lid: 0, glow: 0, duration: 0.3, ease: 'power2.in' })
    audio.play('lid', { vol: 0.35, pitch: 1.3, pos: ballot.pos })
    host.express('happy', 1)
    host.setPose('carrySide')
    await tween(this.boxGrip, { two: 0, duration: 0.35, ease: 'power2.inOut' })
    host.lookAt(null)
    host.setState('walking')
    const exit = host.walk(PATHS.packExit, 2.4).then(() => host.place(MARKS.wing, Math.PI / 2))
    await wait(0.6)
    await this.curtainUp()
    await exit
    await this.hostEnter()
  }

  /** Overlay callback: a card reached its ball → the shell closes with a click and a glint. */
  /** Screen position of the ballot box mouth (live, for the packing overlay). */
  packTarget() {
    return this.project(_v2.copy(ballot.pos).setY(ballot.pos.y + BALLOT_SIZE.h * 0.9))
  }

  packArrive(i: number) {
    if (!ballSystem.balls[i]) return
    audio.play('paper', { vol: 0.25, pitch: 0.9 + Math.random() * 0.3 })
  }
  packDone() {
    this.packResolve?.()
    this.packResolve = null
  }

  project(p: Vector3) {
    if (!this.camera) return { x: innerWidth / 2, y: innerHeight / 2 }
    _v.copy(p).project(this.camera)
    return { x: ((_v.x + 1) / 2) * innerWidth, y: ((1 - _v.y) / 2) * innerHeight }
  }

  private async curtainUp() {
    audio.play('curtain', { vol: 0.9 })
    audio.play('crowd', { vol: 0.6 })
    gsap.to(stage, { curtainWave: 0.9, duration: 0.8, ease: 'power2.out' })
    gsap.to(stage, { curtainWave: 0.12, duration: 2.5, delay: 1.2, ease: 'sine.inOut' })
    const open = tween(stage, { curtainOpen: 1, duration: 2.6, ease: 'power2.inOut' })
    gsap.delayedCall(0.5, () => lightDirector.curtainUp())
    cameraDirector.setShot('wide')
    await cameraDirector.path(
      [new Vector3(0, 1.85, 4.6), new Vector3(0, 1.95, 5.4), new Vector3(0, 2.25, 6.7)],
      [new Vector3(0, 1.85, 1.9), new Vector3(0, 1.6, 1.0), new Vector3(0, 1.25, 0)],
      3.2,
    )
    await open
  }

  // ============================================================= HOST_ENTER
  private async hostEnter() {
    if (!this.phase('HOST_ENTER')) return
    lightDirector.cue('hostEnter')
    lightDirector.followOn()
    cameraDirector.setShot('hostEnter')
    // walks on carrying the ballot box
    ballot.visible = true
    ballot.lid = 0
    this.carryingBox = true
    this.boxGrip.two = 0
    // box on the audience-side palm (walking stage left → right), the upstage hand waves hello
    host.carryHand = 'R'
    host.setPose('carryWave')
    host.setState('walking')
    host.lookAtCamera()
    await host.walk(PATHS.enter, 1.6)
    host.setState('idle')
    await host.faceYaw(-0.3)
    cameraDirector.setShot('hostBow')
    host.lookAtCamera()
    host.express('happy', 2.5)
    void audio.playVoice('voiceStart', host.rig, { vol: 0.85, pos: host.pos })
    await wait(0.5)
    // brings the box round to the front with both hands to open it
    host.setPose('carryBox')
    await tween(this.boxGrip, { two: 1, duration: 0.55, ease: 'power2.inOut' })
    await wait(0.15)

    // opens the box: the balls rise out of it into a cloud above the stage
    if (!this.phase('LOADING_CAGE')) return
    lightDirector.cue('loading')
    // wide: the host, the open box and the balls rising above the stage all in frame
    cameraDirector.setShot('wide')
    host.lookAt(() => _w2.copy(ballot.pos).setY(ballot.pos.y + 0.6))
    await tween(ballot, { lid: -0.04, duration: 0.12 })
    audio.play('lidOpen', { vol: 0.8, pos: ballot.pos })
    gsap.to(ballot, { glow: 1, duration: 0.4 })
    await tween(ballot, { lid: 1, duration: 0.45, ease: 'back.out(1.6)' })
    const balls = ballSystem.balls.filter((b) => b.mode === 'float')
    const spread = Math.min(1.3, balls.length * 0.03)
    const mouth = new Vector3()
    balls.forEach((b, i) => {
      const at = (i / Math.max(1, balls.length)) * spread
      const c = FLOAT_CLOUD
      const dest = new Vector3(c.center.x + vrand(-1, 1) * c.spread.x * 0.5, c.center.y + vrand(-1, 1) * c.spread.y * 0.5, c.center.z + vrand(-1, 1) * c.spread.z * 0.5)
      gsap.delayedCall(at, () => {
        mouth.copy(ballot.pos).add(_w.set(0, BALLOT_SIZE.h, 0))
        b.pos.copy(mouth).add(_w.set(vrand(-0.08, 0.08), 0, vrand(-0.06, 0.06)))
        b.flash = 1
        gsap.to(b, { scale: 1, duration: 0.25, ease: 'back.out(2)' })
        if (i % 5 === 0) audio.play('whoosh', { vol: 0.3, pos: b.pos })
        gsap.to(b.pos, { x: dest.x, y: dest.y, z: dest.z, duration: vrand(0.7, 1.0), ease: 'power2.out' })
      })
    })
    await wait(spread + 0.9)
    gsap.to(ballot, { glow: 0, lid: 0, duration: 0.5, ease: 'power2.in' })
    // back to one hand (the left: the cage is on her/his right), the free hand sends the balls in
    host.carryHand = 'L'
    host.setPose('carrySide')
    await tween(this.boxGrip, { two: 0, duration: 0.45, ease: 'power2.inOut' })
    const lidTop = CAGE.center.clone().setY(CAGE.center.y + CAGE.radius + 0.1)
    void host.gesture(lidTop, 1.4)
    host.lookAt(() => this.flyingCenter(_w))
    // while the balls fly in, the box is put away far upstage so it's never under anyone's feet
    await Promise.all([this.loadCage(balls, true, true), wait(1.4).then(() => this.stowBox())])
    await this.toIdle()
  }

  /** Turns upstage, sets the empty box down out of sight (it vanishes) and turns back to the crank. */
  private async stowBox() {
    if (!this.carryingBox) return
    const yaw = host.yaw
    host.lookAt(null)
    await host.faceYaw(yaw + Math.PI)
    host.crouchT = host.rig.pickup.crouch + 0.05
    host.leanT = host.rig.pickup.lean * 0.5
    audio.play('lid', { vol: 0.25, pitch: 1.4, pos: ballot.pos })
    await tween(ballot, { scale: 0, duration: 0.35, ease: 'power2.in' })
    this.carryingBox = false
    ballot.visible = false
    ballot.scale = 1
    host.setPose('rest')
    host.crouchT = 0
    host.leanT = 0
    await host.faceYaw(yaw)
  }

  private flyingCenter(out: Vector3) {
    let n = 0
    out.set(0, 0, 0)
    for (const b of ballSystem.balls) if (b.mode === 'fly' || b.mode === 'float') (out.add(b.pos), n++)
    return n ? out.divideScalar(n) : out.copy(CAGE.center).setY(CAGE.center.y + 0.4)
  }

  // ============================================================= LOADING_CAGE
  private async loadCage(balls: Ball[], establishing: boolean, alreadyLoading = false) {
    if (!alreadyLoading && !this.phase('LOADING_CAGE')) return
    if (establishing) {
      lightDirector.cue('loading')
      cameraDirector.setShot('loading')
      shotParams.tilt = 0
      gsap.to(shotParams, { tilt: 1, duration: 1.8, ease: 'sine.inOut' })
    }
    // lid: 2° anticipation dip, then swing open
    await tween(stage, { lid: -0.035, duration: 0.1, ease: 'power1.in' })
    audio.play('lidOpen', { vol: 0.7, pos: CAGE.center })
    await tween(stage, { lid: 1.9, duration: 0.35, ease: 'back.out(1.6)' })
    const mouth = CAGE.center.clone().setY(CAGE.center.y + CAGE.radius + 0.03)
    const flights = balls.map(
      (b, i) =>
        new Promise<void>((resolve) => {
          const p0 = b.pos.clone()
          // spread the drop points on a little spiral so no two balls start overlapping in the drum
          const ga = i * 2.39996
          const rr = Math.min(0.24, 0.035 * Math.sqrt(i + 1))
          const p3 = new Vector3(CAGE.center.x + Math.cos(ga) * rr, CAGE.center.y + 0.05 + (i % 3) * 0.04, CAGE.center.z + Math.sin(ga) * rr * 0.8)
          const c1 = p0.clone().add(new Vector3(0, 0.5, 0)).lerp(mouth, 0.25)
          const c2 = mouth.clone().add(new Vector3(vrand(-0.05, 0.05), 0.55, vrand(-0.05, 0.05)))
          const prog = { t: 0 }
          gsap.to(prog, {
            t: 1,
            // whole volley lands within ~1.5 s whatever the ball count
            delay: (i / Math.max(1, balls.length)) * Math.min(1.1, balls.length * 0.04) + vrand(0, 0.02),
            duration: vrand(0.35, 0.5),
            ease: 'power2.in',
            onStart: () => {
              ballSystem.setMode(b, 'fly')
              if (i % 4 === 0) audio.play('whoosh', { vol: 0.35, pos: b.pos })
            },
            onUpdate: () => bezier(b.pos, p0, c1, c2, p3, prog.t),
            onComplete: () => {
              // through the mouth: hand over to physics
              ballSystem.admitToCage(b)
              resolve()
            },
          })
        }),
    )
    await Promise.all(flights)
    await wait(0.25)
    await tween(stage, { lid: 0, duration: 0.28, ease: 'power3.in' })
    audio.play('lid', { vol: 1, pos: CAGE.center })
    cameraDirector.addTrauma(0.15)
    audio.vibrate(15)
  }

  // ============================================================= IDLE_READY
  private async toIdle() {
    if (!this.phase('IDLE_READY')) return
    lightDirector.cue('idle')
    fx.exposure = 1
    cameraDirector.setShot('idle')
    host.setPose('rest')
    host.lookAt(() => CAGE.center)
    gsap.delayedCall(1.5, () => g().phase === 'IDLE_READY' && host.lookAt(null))
    host.idleEnabled = true
    host.setState('idle')
    stage.invited = 'crank'
    stage.cageRock = 1
    // first time only: the single line of hint text
    if (!g().hintShown) {
      g().set({ hint: true, hintShown: true })
      gsap.delayedCall(4, () => g().set({ hint: false }))
    }
    this.scheduleNudge()
  }

  /** If nobody touches anything for 6s, the host points at the crank. */
  private scheduleNudge() {
    this.nudge?.kill()
    this.nudge = gsap.delayedCall(6, async () => {
      if (g().phase !== 'IDLE_READY' || cage.dragging) return
      host.lookAtCamera()
      await host.gesture(knobWorld(new Vector3()), 1.6)
      host.lookAt(null)
      this.scheduleNudge()
    })
  }

  // ============================================================= crank interaction
  /** Pointer down on the crank. Returns true if a drag may start. */
  crankPress(): boolean {
    if (g().phase !== 'IDLE_READY' || g().settingsOpen) {
      audio.play('lock', { vol: 0.6, pos: CAGE.center })
      return false
    }
    this.nudge?.kill()
    g().set({ hint: false })
    host.idleEnabled = false
    host.setState('cranking')
    host.setPose('rest')
    host.quick = true // grab the knob firmly before it starts moving
    host.hopping = true // short hosts bounce up to the knob (rig.crankHop)
    host.reach('R', () => knobWorld(_v), 'down')
    host.lookAt(() => knobWorld(_w))
    void host.faceYaw(-Math.PI / 2 + 0.35)
    if (host.rig.reachStep) {
      // short arms step right up to the knob while turning to it
      const to = knobWorld(_w2).sub(host.pos).setY(0)
      void host.stepTo(to.setLength(host.rig.reachStep * 1.4).add(host.pos))
    }
    stage.invited = 'none'
    stage.cageRock = 0
    cameraDirector.setShot('crankInsert', { kick: true })
    cameraDirector.whip()
    return true
  }

  crankRelease(d: { total: number; omega: number; ms: number }) {
    if (g().phase !== 'IDLE_READY') return
    const isClick = d.total < 0.35 && d.ms < 500
    if (isClick) void this.autoCrank()
    else void this.spinFromDrag(d.omega)
  }

  /** Keyboard / click: the host cranks 2–3 hard turns, then lets the drum run. */
  async autoCrank() {
    if (g().phase !== 'IDLE_READY') return
    if (camState.shot !== 'crankInsert' && !this.crankPress()) return
    // anticipation: lean back a touch before the pull (short arms: after stepping up to the knob)
    host.leanT = -0.08
    await wait(host.rig.reachStep ? 0.7 : 0.25)
    host.leanT = 0.12
    const start = cage.crank
    // several hard turns of the crank, then the drum runs on its own momentum
    const turns = 2.5 + Math.random()
    const done = this.beginSpin(vrand(10.5, 13), false)
    await until(() => cage.crank - start >= turns * Math.PI * 2, 3.5)
    this.releaseCrank()
    await done
  }

  private async spinFromDrag(omega: number) {
    this.releaseCrank()
    await this.beginSpin(Math.max(4, Math.min(16, omega * 1.1)), true)
  }

  private releaseCrank() {
    host.quick = false
    host.hopping = false
    host.reach('R', null)
    host.leanT = 0
    gsap.delayedCall(0.3, async () => {
      // half a step back, hands clasped, eyes on the drum
      await host.step(new Vector3(0, 0, -0.22 - host.rig.reachStep * 1.4))
      await host.faceYaw(-0.55)
      host.setPose('clasp')
      host.lookAt(() => CAGE.center)
    })
  }

  private async beginSpin(peak: number, fromDrag: boolean) {
    if (!this.phase('SPINNING')) return
    this.spunOnce = true
    lightDirector.cue('spinning')
    gsap.delayedCall(0.6, () => cameraDirector.setShot('crankMedium'))
    gsap.delayedCall(1.4, () => {
      if (g().phase !== 'SPINNING') return
      cameraDirector.setShot('spin')
      shotParams.orbit = 0
      gsap.to(shotParams, { orbit: 1, duration: 7, ease: 'sine.inOut' })
    })
    this.omegaPeak = peak * 1.2
    spin.onDecelerate = () => this.decelerate()
    await spin.start(peak, fromDrag)
    await this.dispense()
  }

  private decelerate() {
    if (!this.phase('DECELERATING')) return
    lightDirector.cue('decel')
    cameraDirector.setShot('decel')
    host.leanT = 0.14
    host.lookAt(() => OUTLET.point)
    gsap.to(fx, { exposure: 0.82, duration: 3, ease: 'sine.inOut' })
  }

  // ============================================================= DISPENSING
  private async dispense() {
    spin.normalize()
    if (!this.phase('DISPENSING')) return
    lightDirector.cue('dispensing')
    cameraDirector.setShot('dispense', { kick: true, smooth: 0.15 })
    cameraDirector.whip()
    const b = ballSystem.nearestToOutlet()
    shotTargets.ball.copy(b ? b.pos : OUTLET.point)
    audio.setLoop('drumroll', 0, 0.08)
    await wait(0.25)
    camState.smoothOverride = 0.4
    // gate: tiny dip, then snaps open
    await tween(stage, { gate: -0.05, duration: 0.08 })
    audio.play('gate', { vol: 0.9, pos: OUTLET.point })
    gsap.to(stage, { gate: 1.3, duration: 0.18, ease: 'back.out(2)' })
    if (!b) return
    this.drawn = b
    ballSystem.setMode(b, 'exit')
    const lip = CHUTE.start.clone().add(new Vector3(0, BALL_RADIUS + 0.004, 0.02))
    await tween(b.pos, { x: OUTLET.point.x, y: OUTLET.point.y, z: OUTLET.point.z, duration: 0.16, ease: 'power2.in' })
    await tween(b.pos, { x: lip.x, y: lip.y, z: lip.z, duration: 0.08, ease: 'none' })
    // the result is decided now, as the ball leaves the cage (crypto RNG)
    if (g().drawWinner()) this.sessionWins++
    host.express('surprised', 1.2)
    const dir = CHUTE.end.clone().sub(CHUTE.start).normalize()
    const sp = vrand(0.9, 1.4)
    ballSystem.launchChute(b, { x: dir.x * sp + vrand(-0.08, 0.08), y: dir.y * sp, z: dir.z * sp }, { x: vrand(10, 25), y: vrand(-6, 6), z: vrand(-4, 4) })
    audio.play('roll', { vol: 0.6, pos: b.pos })
    gsap.delayedCall(0.6, () => gsap.to(stage, { gate: 0, duration: 0.3, ease: 'power2.in' }))
    // let physics settle it on the velvet
    let still = 0
    await until(() => {
      still = ballSystem.chuteSpeed() < 0.03 ? still + 1 : 0
      return still > 8
    }, 2.5)
    audio.vibrate(12)
    // drifted off the tray? ease it back (no hard snap)
    if (!ballSystem.inTray(b)) {
      const tx = Math.max(TRAY.center.x - 0.12, Math.min(TRAY.center.x + 0.12, b.pos.x))
      const tz = Math.max(TRAY.center.z - 0.07, Math.min(TRAY.center.z + 0.07, b.pos.z))
      ballSystem.setMode(b, 'exit')
      await tween(b.pos, { x: tx, y: TRAY.center.y + 0.01 + BALL_RADIUS, z: tz, duration: 0.5, ease: 'power2.inOut' })
    }
    await this.hostPickup(b)
  }

  // ============================================================= HOST_PICKUP
  private async hostPickup(b: Ball) {
    if (!this.phase('HOST_PICKUP')) return
    lightDirector.cue('pickup')
    gsap.to(fx, { exposure: 1, duration: 1 })
    await wait(0.2)
    cameraDirector.setShot('pickup')
    host.setPose('rest')
    host.setState('walkingToTray')
    host.lookAt(() => b.pos)
    // big heads stand further off the table's end (the ball hops into the paw instead)
    const off = host.rig.trayStandoff
    await host.walk(off ? [...PATHS.toTray.slice(0, -1), MARKS.tray.clone().add(_w.set(off, 0, off * 0.3))] : PATHS.toTray, 1.6)
    await host.facePoint(b.pos)
    host.setState('pickingUp')
    audio.play('rustle', { vol: 0.4, pos: host.pos })
    host.crouchT = host.rig.pickup.crouch
    host.leanT = host.rig.pickup.lean
    host.quick = true // brisk lean-in for the grab
    host.reach('R', () => _v.copy(b.pos).add(_w.set(0, 0.035, 0)), 'down')
    await host.waitUntil(() => host.palm.R.distanceTo(b.pos) < 0.1, 0.9)
    // grab: the ball leaves the instanced pool and becomes the hero mesh attached to the hand
    hero.pos.copy(b.pos)
    hero.quat.copy(b.quat)
    hero.color.copy(b.color)
    hero.open = 0
    hero.crack = 0
    hero.glow = 0
    hero.scale = 1
    hero.spin = 0
    hero.split = 0
    hero.visible = true
    ballSystem.setMode(b, 'hero')
    this.heroAttached = 'R'
    audio.play('tick', { vol: 0.4 })
    host.reach('R', null)
    host.crouchT = 0
    host.leanT = 0
    gsap.delayedCall(0.6, () => void (host.quick = false))
    host.setPose('present')
    host.setState('holding')
    host.lookAt(() => hero.pos)
    // display size in the hand (the real ball is tiny next to a chibi fist)
    gsap.to(hero, { scale: host.rig.hold.ballScale, duration: 0.6, ease: 'back.out(1.6)' })
    await wait(0.2)
    // short arms stepped up to the tray: back to the mark first, then turn to the audience
    const cam = this.camera ? this.camera.getWorldPosition(new Vector3()) : new Vector3(0, 1, 4)
    await host.faceYaw(Math.atan2(cam.x - host.pos.x, cam.z - host.pos.z) - 0.15)
    await this.ballPresented()
  }

  // ============================================================= BALL_PRESENTED
  private async ballPresented() {
    if (!this.phase('BALL_PRESENTED')) return
    host.setState('presenting')
    lightDirector.cue('presented')
    cameraDirector.setShot('presented')
    gsap.to(hero, { glow: 1, spin: 0.7, duration: 1.2 })
    audio.setLoop('drumroll', 0.45, 0.4)
    stage.invited = 'ball'
    shotParams.focusMix = 0
    // rack focus ball → face → ball
    gsap.timeline().to(shotParams, { focusMix: 1, duration: 1.2, delay: 1.2, ease: 'sine.inOut' }).to(shotParams, { focusMix: 0, duration: 1.0, delay: 0.6, ease: 'sine.inOut' })
    gsap.delayedCall(1.6, () => {
      if (g().phase !== 'BALL_PRESENTED') return
      host.lookAtCamera()
      host.express('happy', 1.4)
    })
    gsap.delayedCall(3.2, () => g().phase === 'BALL_PRESENTED' && host.lookAt(() => hero.pos))
    this.autoOpen?.kill()
    this.autoOpen = gsap.delayedCall(3.5, () => this.ballTap())
  }

  canOpenBall() {
    return g().phase === 'BALL_PRESENTED'
  }

  ballTap() {
    if (g().phase !== 'BALL_PRESENTED') return
    this.autoOpen?.kill()
    void this.opening()
  }

  // ============================================================= OPENING → TICKET_SHOWN
  private async opening() {
    if (!this.phase('OPENING')) return
    stage.invited = 'none'
    host.setState('opening')
    host.setPose('openBall')
    // left hand comes to the top of the ball (right hand holds the bottom)
    // left hand closes over the ball from above, the right one cradles it from below
    host.reach('L', () => _v.copy(hero.pos).add(_w.set(0.02, BALL_RADIUS * hero.scale + 0.035, 0)), 'down')
    shotParams.push = 0
    shotTargets.openAt.copy(hero.pos)
    cameraDirector.setShot('opening')
    gsap.to(shotParams, { push: 1, duration: 1.1, ease: 'power2.in' })
    hero.spin = 0
    hero.split = 0
    // anticipation: the shell squeezes before it splits
    await tween(hero, { scale: host.rig.hold.ballScale * 0.95, crack: 0.6, duration: 0.55, ease: 'power2.in' })
    audio.setLoop('drumroll', 0, 0.05)
    audio.play('shellOpen', { vol: 1, pos: hero.pos })
    audio.play('cymbal', { vol: 0.9 })
    audio.vibrate(25)
    cameraDirector.addTrauma(0.35)
    lightDirector.burst(hero.color)
    host.express('surprised', 0.9)
    gsap.to(hero, { scale: host.rig.hold.ballScale, duration: 0.3, ease: 'back.out(3)' })
    // the ball splits in her hands: the top half leaves with the left hand, light pours out
    gsap.to(hero, { open: 1, duration: 0.8, ease: 'power2.out' })
    this.topFollowL = true
    await tween(hero, { split: 1, duration: 0.45, ease: 'power2.out' })
    host.reach('L', null) // the pose carries the left hand (and the half) out to her side
    await wait(0.5)

    // the folded ticket rises out of the glowing lower half
    const y0 = host.metrics ? host.metrics.shoulder.L.y : 1.2
    ticket.visible = true
    ticket.unfold = 0
    ticket.flip = 0
    ticket.scale = 0.4
    host.root.getWorldQuaternion(ticket.quat)
    this.ticketLocal.copy(this.toHostLocal(hero.pos)).add(_w.set(0, 0.04, 0.02))
    this.ticketHold = true
    audio.play('paper', { vol: 0.7 })
    gsap.to(ticket, { scale: host.rig.ticketScale, duration: 0.6, ease: 'back.out(1.8)' })
    await tween(this.ticketLocal, { y: this.ticketLocal.y + 0.16, duration: 0.6, ease: 'power2.out' })

    // the two halves float down onto the tray by themselves; she takes the ticket by both sides
    this.heroAttached = null
    this.topFollowL = false
    hero.trayPos.set(TRAY.center.x - 0.05, TRAY.center.y + BALL_RADIUS + 0.005, TRAY.center.z)
    gsap.to(hero, { scale: 1, duration: 0.9, ease: 'power2.inOut' })
    gsap.to(hero.pos, { x: hero.trayPos.x, y: hero.trayPos.y, z: hero.trayPos.z, duration: 0.9, ease: 'power2.inOut' })
    gsap.to(hero.topPos, { x: hero.trayPos.x + 0.1, y: hero.trayPos.y + 0.005, z: hero.trayPos.z + 0.02, duration: 1.0, ease: 'power2.inOut', onComplete: () => audio.play('hitBall', { vol: 0.4, pos: hero.pos }) })
    host.setPose('rest')
    host.reach('L', () => this.ticketEdge(1, _v), 'in')
    host.reach('R', () => this.ticketEdge(-1, _w2), 'in')
    host.lookAt(() => ticket.pos)
    cameraDirector.setShot('presented')
    await tween(this.ticketLocal, { x: 0, y: y0 - 0.12, z: 0.38, duration: 0.8, ease: 'power2.inOut' })

    // she unfolds it slowly: one fold, then the other
    audio.play('paper', { vol: 0.6 })
    gsap.delayedCall(0.85, () => audio.play('paper', { vol: 0.6, pitch: 1.1 }))
    await tween(ticket, { unfold: 1, duration: 1.7, ease: 'sine.inOut' })
    // the ticket is open: now the tinsel cannons go off across the stage
    confetti.burst(new Vector3(-1.6, 2.7, 0.2), 350, 2.4, new Vector3(1.0, 0.4, 0.8), 2.4)
    confetti.burst(host.pos.clone().setY(2.8), 450, 2.6, new Vector3(1.4, 0.4, 0.8), 2.6)
    confetti.burst(new Vector3(1.6, 2.7, 0.2), 350, 2.4, new Vector3(1.0, 0.4, 0.8), 2.4)
    audio.play('confetti', { vol: 0.7 })
    await wait(0.2)

    // then holds it up at her right side, turns to us and smiles
    await tween(this.ticketLocal, { x: -0.36, y: y0 - 0.02, z: 0.3, duration: 0.7, ease: 'power2.inOut' })
    host.lookAtCamera()
    host.express('happy')
    audio.play('chime', { vol: 0.35 })
    audio.play('applause', { vol: 0.55 })
    await wait(1.1)

    // the ticket flies to camera, flips once and stops square to the lens
    this.ticketHold = false
    host.reach('L', null)
    host.reach('R', null)
    gsap.delayedCall(2.5, () => host.express('neutral'))
    const q0 = ticket.quat.clone()
    const look = new Vector3().subVectors(ticketCam.pos, ticketCam.ticketPos)
    const q1 = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.atan2(look.x, look.z))
    const prog = { t: 0 }
    cameraDirector.setShot('ticket')
    lightDirector.cue('ticket')
    audio.play('whoosh', { vol: 0.5 })
    const from = ticket.pos.clone()
    gsap.to(ticket, { scale: 1, duration: 0.9, ease: 'power2.inOut' })
    await tween(prog, {
      t: 1,
      duration: 0.9,
      ease: 'power3.inOut',
      onUpdate: () => {
        const k = prog.t
        ticket.pos.lerpVectors(from, ticketCam.ticketPos, k).add(_w.set(0, Math.sin(k * Math.PI) * 0.15, 0))
        ticket.quat.slerpQuaternions(q0, q1, k)
        ticket.flip = k * Math.PI * 2
      },
    })
    ticket.flip = 0
    void host.clapFor(1.8)
    await this.ticketShown()
  }

  /** Point on the ticket's left (+1, her left) or right (-1) edge, where a hand grips it. */
  private ticketEdge(side: 1 | -1, out: Vector3) {
    const v = smoothClamp(ticket.unfold * 2)
    // folded, the paper spans x ∈ [-W/2, 0]; unfolded [-W/2, W/2]
    const x = (side < 0 ? -TICKET_W / 2 : (TICKET_W / 2) * v) * ticket.scale
    // grip from just outside the side edge, a bit low and behind, so the hands never cover the text
    return out.set(x + Math.sign(x || side) * 0.05, -0.04 * ticket.scale, -0.06).applyQuaternion(ticket.quat).add(ticket.pos)
  }

  private toHostLocal(p: Vector3) {
    host.root.updateMatrixWorld()
    return host.root.worldToLocal(p.clone())
  }

  private async ticketShown() {
    if (!this.phase('TICKET_SHOWN')) return
    host.setState('presenting')
    stage.invited = 'ticket'

    // Confetti shower directly framing the presented ticket in camera view
    const tPos = ticketCam.ticketPos
    // Center shower directly above and slightly in front of the ticket
    confetti.burst(new Vector3(tPos.x, tPos.y + 0.65, tPos.z + 0.12), 500, 1.8, new Vector3(1.4, 0.35, 0.5), 1.4)
    // Left & right celebration flanking the ticket on screen
    confetti.burst(new Vector3(tPos.x - 0.75, tPos.y + 0.7, tPos.z + 0.05), 250, 2.0, new Vector3(0.7, 0.3, 0.5), 1.6)
    confetti.burst(new Vector3(tPos.x + 0.75, tPos.y + 0.7, tPos.z + 0.05), 250, 2.0, new Vector3(0.7, 0.3, 0.5), 1.6)
    audio.play('confetti', { vol: 0.85 })

    void audio.playVoice('voiceCongrats', host.rig, { vol: 0.9, pos: host.pos })
    audio.play('applause', { vol: 0.9 })
    // audio.play('chime', { vol: 0.5 })
  }

  // ------------------------------------------------------------- ticket gestures
  ticketTap(y: number) {
    if (g().phase !== 'TICKET_SHOWN') return
    this.ticketDown = y
  }
  ticketRelease(y: number) {
    if (g().phase !== 'TICKET_SHOWN' || this.ticketDown === null) return
    const dy = this.ticketDown - y
    this.ticketDown = null
    // tap or swipe up = file it; swipe down = close (same path, quicker)
    void this.stashTicket(dy < -40)
  }

  private stashing = false
  async stashTicket(quick = false) {
    if (g().phase !== 'TICKET_SHOWN' || this.stashing) return
    this.stashing = true
    stage.invited = 'none'
    audio.play('paper', { vol: 0.6 })
    cameraDirector.setShot('pickup')
    if (quick) this.setSpeed(2)
    // back into her hand
    const from = ticket.pos.clone()
    const prog = { t: 0 }
    host.setPose('present')
    await tween(prog, {
      t: 1,
      duration: 0.8,
      ease: 'power2.inOut',
      onUpdate: () => ticket.pos.lerpVectors(from, host.palm.R, prog.t),
    })
    this.ticketFollowHands = true
    host.setPose('rest')
    // drop it in the keepsake box
    await host.facePoint(TICKET_BOX)
    host.leanT = 0.35
    const boxTop = TICKET_BOX.clone().add(new Vector3(0, 0.1, 0))
    // eyes down on the box while the ticket goes in
    host.lookAt(() => TICKET_BOX)
    host.bowT = 0.25
    host.reach('R', () => boxTop, 'down')
    await host.waitUntil(() => host.palm.R.distanceTo(boxTop) < 0.12, 1.4)
    this.ticketFollowHands = false
    await tween(ticket, { scale: 0.15, duration: 0.35, ease: 'power2.in' })
    await tween(ticket.pos, { x: TICKET_BOX.x, y: TICKET_BOX.y + 0.03, z: TICKET_BOX.z, duration: 0.2 })
    ticket.visible = false
    audio.play('paper', { vol: 0.5, pitch: 0.8 })
    host.reach('R', null)
    host.leanT = 0
    host.bowT = 0
    host.lookAt(null)
    // tidy: the shell halves fade away
    await tween(hero, { scale: 0, duration: 0.4, ease: 'power2.in' })
    hero.visible = false
    if (this.drawn) ballSystem.setMode(this.drawn, 'hidden')
    this.drawn = null
    this.stashing = false
    await this.afterDraw()
  }

  /** Back to the crank, refill the drum if the pool allows, or finish. */
  private async afterDraw() {
    const s = g()
    // the show ends when the list runs out, the winner quota is met, or "curtain down" was asked for
    const limit = s.winnerLimit
    if (!s.pool.length || (limit !== null && this.sessionWins >= limit) || this.endRequested) return this.finish()
    host.setState('walking')
    host.lookAt(null)
    cameraDirector.setShot('idle')
    lightDirector.cue('idle')
    await host.walk(PATHS.toCrank, 1.5)
    await host.faceYaw(-0.35)
    // "remove winners" on: the drum simply empties draw by draw (no ball is added back); only if it
    // runs dry while names remain (lists > 200) is it refilled. Off: the drawn ball is replaced.
    const have = ballSystem.inCage.length
    const want = g().removeWinners ? (have === 0 ? ballsFor(g().pool.length) : 0) : ballsFor(g().pool.length)
    if (have < want) {
      const fresh: Ball[] = []
      for (let i = 0; i < want - have; i++) {
        const b = ballSystem.freeBall()
        if (!b) break
        b.pos.set(vrand(-0.6, 0.6), 2.6, vrand(0, 0.6))
        b.scale = 0
        ballSystem.setMode(b, 'float')
        gsap.to(b, { scale: 1, duration: 0.35, ease: 'back.out(2)' })
        fresh.push(b)
      }
      host.lookAt(() => this.flyingCenter(_w))
      await wait(0.4)
      await this.loadCage(fresh, false)
    }
    await this.toIdle()
  }

  // ============================================================= FINISHED
  /**
   * "Curtain down" requested by the player: idle → end now; ticket on display → file it, then end;
   * mid-draw → finish this draw first, then end.
   */
  requestEnd() {
    const p = g().phase
    if (p === 'EDITING' || p === 'FINISHED' || this.endRequested) return
    this.endRequested = true
    audio.play('lock', { vol: 0.5 })
    if (p === 'IDLE_READY') {
      this.nudge?.kill()
      void this.finish()
    } else if (p === 'TICKET_SHOWN') void this.stashTicket(true)
  }
  get ending() {
    return this.endRequested
  }

  private async finish() {
    if (!this.phase('FINISHED')) return
    stage.invited = 'none'
    host.idleEnabled = false
    host.setState('walking')
    host.lookAt(null)
    cameraDirector.setShot('wide')
    await host.walk(host.pos.distanceTo(MARKS.tray) < 0.3 + host.rig.trayStandoff ? [MARKS.tray, new Vector3(1.25, 0, 1.0), MARKS.bow] : PATHS.toBow, 1.0)
    await host.faceYaw(0)
    host.lookAtCamera()
    host.express('happy', 4)
    await host.bowOnce(0.9)
    await host.waveFor(1.2)
    cameraDirector.setShot('finished')
    host.setState('walkingOut')
    host.lookAt(null)
    const out = host.walk(PATHS.exit, 1.15)
    await wait(1.5)
    lightDirector.finale()
    audio.setLoop('music', 0.2, 3)
    audio.play('curtain', { vol: 0.8 })
    gsap.to(stage, { curtainWave: 0.7, duration: 1, ease: 'power2.out' })
    gsap.to(stage, { curtainWave: 0.12, duration: 3, delay: 1.5 })
    await tween(stage, { curtainOpen: 0, duration: 4.5, ease: 'power2.inOut' })
    await out
    host.setState('offstage')
    gsap.to(stage, { finale: 1, duration: 2, ease: 'sine.inOut' })
  }

  // ============================================================= props
  async toEditing() {
    const p = g().phase
    if (!['IDLE_READY', 'TICKET_SHOWN', 'FINISHED'].includes(p)) {
      audio.play('lock', { vol: 0.5 })
      return
    }
    this.nudge?.kill()
    g().set({ settingsOpen: false, historyOpen: false, hint: false, editorOpen: true })
    stage.invited = 'none'
    gsap.to(stage, { finale: 0, duration: 0.6 })
    ticket.visible = false
    gsap.to(hero, { scale: 0, duration: 0.3, onComplete: () => void (hero.visible = false) })
    this.carryingBox = false
    gsap.to(ballot, { scale: 0, duration: 0.4, onComplete: () => void (ballot.visible = false) })
    if (this.drawn) ballSystem.setMode(this.drawn, 'hidden')
    this.drawn = null
    host.idleEnabled = false
    // close the curtain and walk off while the editor fades in
    this.phase('EDITING')
    lightDirector.cue('editing')
    // the list editor is quiet: music and room tone fade out until the next show
    audio.setLoop('music', 0, 1.5)
    audio.setLoop('room', 0, 1.5)
    audio.play('curtain', { vol: 0.7 })
    gsap.to(stage, { curtainOpen: 0, curtainWave: 0.4, duration: 2.2, ease: 'power2.inOut' })
    gsap.to(stage, { curtainWave: 0.15, duration: 2, delay: 2.2 })
    cameraDirector.setShot('editing')
    if (host.pos.x > -4) {
      host.setState('walkingOut')
      void host.walk(host.pos.distanceTo(MARKS.tray) < 0.3 + host.rig.trayStandoff ? PATHS.exitFromTray : PATHS.exitFromCrank, 1.6).then(() => host.setState('offstage'))
    }
    await wait(2.3)
    if (g().phase === 'EDITING') ballSystem.reset()
  }

  /** Settings panel (2D) — available at any time; the show keeps running behind it. */
  openSettings() {
    if (g().settingsOpen) return
    void audio.unlock()
    g().set({ settingsOpen: true })
    audio.play('tick', { vol: 0.5 })
  }
  closeSettings() {
    if (!g().settingsOpen) return
    g().set({ settingsOpen: false })
  }

  openHistory() {
    if (this.busy) return void audio.play('lock', { vol: 0.5 })
    audio.play('paper', { vol: 0.5 })
    g().set({ historyOpen: true })
  }

  hostTap() {
    const p = g().phase
    if (p === 'IDLE_READY' && !host.isWalking) {
      this.scheduleNudge()
      if (!this.spunOnce && Math.random() < 0.5) {
        host.lookAtCamera()
        void host.gesture(knobWorld(new Vector3()), 1.4).then(() => host.lookAt(null))
      } else {
        const prev = host.pose
        host.express('happy', 1.6)
        void host.waveFor(1.4).then(() => {
          host.setPose(prev === 'wave' ? 'rest' : prev)
          host.lookAt(null)
        })
      }
      audio.play('rustle', { vol: 0.3, pos: host.pos })
    } else if (p !== 'EDITING') {
      host.lookAtCamera()
      gsap.delayedCall(1.5, () => g().phase !== 'BALL_PRESENTED' && host.lookAt(null))
    }
  }

  /** Tapping the idle drum rattles it. */
  cageTap() {
    if (g().phase !== 'IDLE_READY' || spin.phase !== 'idle') return void (this.busy || audio.play('hitBrass', { vol: 0.4, pos: CAGE.center }))
    this.scheduleNudge()
    gsap
      .timeline()
      .to(cage, { angle: 0.14, duration: 0.12, ease: 'power2.out' })
      .to(cage, { angle: -0.08, duration: 0.18, ease: 'sine.inOut' })
      .to(cage, { angle: 0.03, duration: 0.16, ease: 'sine.inOut' })
      .to(cage, { angle: 0, duration: 0.2, ease: 'sine.out', onUpdate: () => void (cage.crank = cage.angle) })
    audio.play('hitBrass', { vol: 0.6, pos: CAGE.center })
  }

  curtainTap() {
    audio.play('rustle', { vol: 0.35 })
  }

  /** Keyboard shortcuts (hidden): Space spin/continue, Enter open, Esc close. */
  key(code: string) {
    const p = g().phase
    if (code === 'Space') {
      if (p === 'IDLE_READY') void this.autoCrank()
      else if (p === 'TICKET_SHOWN') void this.stashTicket(true)
      else this.skip(false)
    } else if (code === 'KeyF') {
      this.toggleFast()
    } else if (code === 'Enter') {
      if (p === 'BALL_PRESENTED') this.ballTap()
    } else if (code === 'Escape') {
      if (g().historyOpen) g().set({ historyOpen: false })
      else if (g().settingsOpen) this.closeSettings()
      else if (p === 'TICKET_SHOWN') void this.stashTicket(true)
    }
  }

  // ============================================================= per-frame glue
  tick(dt: number, t: number) {
    // invite pulse on the one object we want touched
    stage.invite = stage.invited === 'none' ? 0 : 0.5 + 0.5 * Math.sin(t * 2.6)
    lights.practical = g().phase === 'IDLE_READY' ? Math.max(lights.practical, 0.6) : lights.practical
    // hero ball rides the palm
    if (this.heroAttached === 'R' && hero.visible) {
      // rest the ball on top of the (mitten-like) sleeve cuff
      _v.copy(host.palm.R).addScaledVector(host.palmNormal.R, BALL_RADIUS * hero.scale + host.rig.hold.lift)
      hero.pos.lerp(_v, 1 - Math.exp(-25 * dt))
    }
    if (this.carryingBox && ballot.visible) {
      host.root.getWorldQuaternion(_qBody)
      // two hands: gripped by the middle of its sides, bottom a little below the palms
      _v.copy(host.palm.L).add(host.palm.R).multiplyScalar(0.5)
      _v.add(_w.set(0, -BALLOT_SIZE.h * 0.55, 0))
      // one hand: sitting on that palm, turned sideways (narrow side against the hip), nudged outward
      const c = host.carryHand
      _v2.copy(host.palm[c]).add(_w.set(c === 'L' ? 0.03 : -0.03, -0.01, 0).applyQuaternion(_qBody))
      _v.lerpVectors(_v2, _v, this.boxGrip.two)
      ballot.quat.copy(_qBody).multiply(_qTmp.copy(_qSide).slerp(_qIdentity, this.boxGrip.two))
      ballot.pos.lerp(_v, 1 - Math.exp(-30 * dt))
    }
    if (this.topFollowL && hero.visible) {
      hero.topPos.lerp(_v.copy(host.palm.L).addScaledVector(host.palmNormal.L, BALL_RADIUS * hero.scale + host.rig.hold.lift), 1 - Math.exp(-25 * dt))
      // cupped half-shell, open side shown to the audience
      host.root.getWorldQuaternion(hero.topQuat).multiply(_qFlip)
    }
    if (this.ticketHold && ticket.visible) {
      // folded paper is centred between the hands while it opens
      const v = smoothClamp(ticket.unfold * 2)
      const h = smoothClamp(ticket.unfold * 2 - 1)
      _v.copy(this.ticketLocal).add(_w.set((TICKET_W / 4) * (1 - v) * ticket.scale, (TICKET_H / 4) * (1 - h) * ticket.scale, 0))
      ticket.pos.copy(host.root.localToWorld(_v))
      host.root.getWorldQuaternion(ticket.quat)
    }
    if (this.ticketFollowHands && ticket.visible) {
      _v.copy(host.palm.L).add(host.palm.R).multiplyScalar(0.5).add(_w.set(0, 0.06, 0))
      ticket.pos.lerp(_v, 1 - Math.exp(-18 * dt))
      host.root.getWorldQuaternion(ticket.quat)
    }
    if (this.drawn && (g().phase === 'DISPENSING' || g().phase === 'HOST_PICKUP')) shotTargets.ball.lerp(this.drawn.pos, 1 - Math.exp(-12 * dt))
    // spin-driven audio + push-in
    const w = Math.abs(cage.omega)
    const ph = g().phase
    if (ph === 'DECELERATING') {
      shotParams.push = Math.min(1, Math.max(shotParams.push, 1 - w / this.omegaPeak))
      // audio.setLoop('drumroll', 0.15 + shotParams.push * 0.55, 0.2)
    } else if (ph !== 'BALL_PRESENTED') audio.setLoop('drumroll', 0, 0.4)
  }
}

function bezier(out: Vector3, p0: Vector3, p1: Vector3, p2: Vector3, p3: Vector3, t: number) {
  const u = 1 - t
  out.set(0, 0, 0)
    .addScaledVector(p0, u * u * u)
    .addScaledVector(p1, 3 * u * u * t)
    .addScaledVector(p2, 3 * u * t * t)
    .addScaledVector(p3, t * t * t)
}

export const director = new Director()
