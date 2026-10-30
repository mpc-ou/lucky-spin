import { useMemo } from 'react'
import { useSettingsStore, type QualityLevel } from '../store/useSettingsStore'

export interface QualityPreset {
  dpr: [number, number]
  /** 0 = static contact shadow only, else shadow map size */
  shadowSize: number
  followShadow: boolean
  softShadows: boolean
  /** 0 = fake env reflection, else MeshReflectorMaterial resolution */
  reflectorRes: number
  cones: 'off' | 'main' | 'all'
  dustInCones: boolean
  bloom: boolean
  dof: boolean
  chroma: boolean
  grain: boolean
  motionBlur: boolean
  confetti: number
  hostShadow: boolean
  hostRim: boolean
  fullIK: boolean
  /** Skeleton update rate when host is idle/far (Hz, 0 = every frame) */
  skeletonHz: number
  fogLayers: number
  /** stage haze puffs in the air (0 = off) */
  smoke: number
  /** SMAA edge anti-aliasing (MSAA is never used: it breaks the depth-of-field pass) */
  antialias: boolean
}

export const QUALITY: Record<QualityLevel, QualityPreset> = {
  low: {
    dpr: [0.75, 1], shadowSize: 0, followShadow: false, softShadows: false, reflectorRes: 0,
    cones: 'off', dustInCones: false, bloom: false, dof: false, chroma: false, grain: false, motionBlur: false, confetti: 400, hostShadow: false, hostRim: false, fullIK: false, skeletonHz: 30,
    fogLayers: 0, smoke: 0, antialias: false,
  },
  medium: {
    dpr: [1, 1.25], shadowSize: 1024, followShadow: false, softShadows: false, reflectorRes: 0,
    cones: 'main', dustInCones: false, bloom: true, dof: false, chroma: false, grain: false, motionBlur: false, confetti: 800, hostShadow: true, hostRim: false, fullIK: false, skeletonHz: 0,
    fogLayers: 1, smoke: 10, antialias: true,
  },
  high: {
    dpr: [1, 1.5], shadowSize: 1024, followShadow: false, softShadows: false, reflectorRes: 0,
    cones: 'all', dustInCones: false, bloom: true, dof: true, chroma: true, grain: false, motionBlur: false, confetti: 1200, hostShadow: true, hostRim: true, fullIK: false, skeletonHz: 0,
    fogLayers: 1, smoke: 16, antialias: true,
  },
  ultra: {
    dpr: [1, 2], shadowSize: 2048, followShadow: true, softShadows: true, reflectorRes: 512,
    cones: 'all', dustInCones: true, bloom: true, dof: true, chroma: true, grain: true, motionBlur: true, confetti: 1600, hostShadow: true, hostRim: true, fullIK: true, skeletonHz: 0,
    fogLayers: 3, smoke: 24, antialias: true,
  },
}

/** Options the player can override one by one on top of the chosen level. */
export type QualityOverrides = Partial<QualityPreset>

/** Effective preset = chosen/auto level + the player's per-option overrides + render scale. */
export function useQuality(): QualityPreset {
  const level = useSettingsStore((s) => s.level)
  const custom = useSettingsStore((s) => s.custom)
  const scale = useSettingsStore((s) => s.renderScale)
  return useMemo(() => {
    const q = { ...QUALITY[level], ...custom }
    return { ...q, dpr: [Math.max(0.4, q.dpr[0] * scale), Math.max(0.4, q.dpr[1] * scale)] as [number, number] }
  }, [level, custom, scale])
}
