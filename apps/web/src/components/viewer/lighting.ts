import * as THREE from 'three'

/**
 * Lighting presets. docs/08 §8.1
 *
 * Three moods, and the reason there are exactly three: a client asking "what
 * does it look like in the evening" is asking a real question about a real
 * decision, while a slider with fifteen parameters is asking them to become a
 * lighting designer.
 *
 * No HDRI yet. docs/08 §8.1 specifies an environment map, and that is the
 * right destination — it is also a megabyte of texture per preset and a CDN to
 * serve it from. A hemisphere light plus a keyed sun gets convincingly close
 * for interior massing, and the seam where it does not (glossy metal, glass)
 * is not what a finishing contractor's client is looking at.
 */

export type LightingPreset = 'daylight' | 'evening' | 'neutral'

export const LIGHTING_PRESETS: LightingPreset[] = ['daylight', 'evening', 'neutral']

interface PresetSpec {
  /** Sky and ground, which together do the work an environment map would. */
  sky: number
  ground: number
  ambient: number
  sun: { colour: number; intensity: number; position: [number, number, number] }
  /** What the renderer clears to — the "outside" seen through a window. */
  background: number
  exposure: number
}

const SPECS: Record<LightingPreset, PresetSpec> = {
  daylight: {
    sky: 0xdcecff,
    ground: 0xb9a893,
    ambient: 0.55,
    sun: { colour: 0xfff4e0, intensity: 2.4, position: [12, 18, 8] },
    background: 0xeaf2fb,
    exposure: 1,
  },
  evening: {
    // Low, warm and from one side — the light that makes a room look lived in.
    sky: 0x30364a,
    ground: 0x1a1712,
    ambient: 0.25,
    sun: { colour: 0xffb266, intensity: 1.9, position: [-16, 5, -6] },
    background: 0x1b2233,
    exposure: 1.15,
  },
  neutral: {
    // Flat and shadowless: the preset for judging a colour rather than a mood.
    sky: 0xffffff,
    ground: 0xdddddd,
    ambient: 1.05,
    sun: { colour: 0xffffff, intensity: 0.9, position: [6, 20, 6] },
    background: 0xf4f4f5,
    exposure: 1,
  },
}

export interface Lighting {
  group: THREE.Group
  apply: (preset: LightingPreset) => void
  dispose: () => void
}

/**
 * One set of lights, reconfigured per preset rather than rebuilt.
 *
 * Swapping presets should be instant; tearing down and re-adding lights makes
 * Three recompile every material's shader, which stalls for a visible beat on
 * a scene of any size.
 */
export function createLighting(renderer: THREE.WebGLRenderer, scene: THREE.Scene): Lighting {
  const group = new THREE.Group()
  group.name = 'lighting'

  const hemisphere = new THREE.HemisphereLight(0xffffff, 0xffffff, 1)
  const ambient = new THREE.AmbientLight(0xffffff, 0.4)
  const sun = new THREE.DirectionalLight(0xffffff, 1)

  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.camera.near = 0.5
  sun.shadow.camera.far = 120
  // A generous frustum: too tight and the shadows stop at an invisible line
  // across the floor, which reads as a rendering fault rather than as a limit.
  sun.shadow.camera.left = -40
  sun.shadow.camera.right = 40
  sun.shadow.camera.top = 40
  sun.shadow.camera.bottom = -40

  group.add(hemisphere, ambient, sun, sun.target)

  const apply = (preset: LightingPreset) => {
    const spec = SPECS[preset]
    hemisphere.color.setHex(spec.sky)
    hemisphere.groundColor.setHex(spec.ground)
    ambient.intensity = spec.ambient
    sun.color.setHex(spec.sun.colour)
    sun.intensity = spec.sun.intensity
    sun.position.set(...spec.sun.position)
    sun.target.position.set(0, 0, 0)
    scene.background = new THREE.Color(spec.background)
    renderer.toneMappingExposure = spec.exposure
  }

  return {
    group,
    apply,
    dispose: () => {
      sun.shadow.map?.dispose()
      group.clear()
    },
  }
}
