<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import * as THREE from 'three'
import { extrudePlan, solidCount, type SceneModel } from '@buildflow/spatial'
import { usePlannerStore } from '@/stores/planner'
import {
  applyFinish,
  buildScene,
  disposeScene,
  type BuiltScene,
  type DrawnSurface,
} from './scene-builder'
import FinishPanel from './FinishPanel.vue'
import { createLighting, LIGHTING_PRESETS, type Lighting, type LightingPreset } from './lighting'
import { CAMERA_MODES, createCameraRig, type CameraMode, type CameraRig } from './camera-modes'

/**
 * The 3D viewer. docs/08 §8
 *
 * Loaded lazily by the planner — six hundred kilobytes of Three.js has no
 * business in the bundle of a user who never opens it. docs/08 §8.4
 *
 * The scene is rebuilt when the PLAN changes and never when the camera moves,
 * which is the split that keeps this responsive: geometry is expensive and
 * rare, the render loop is cheap and constant.
 */

const { t } = useI18n()
const store = usePlannerStore()

const host = ref<HTMLDivElement | null>(null)
const mode = ref<CameraMode>('room')
const preset = ref<LightingPreset>('daylight')
const drawCalls = ref(0)
const fps = ref(0)

let renderer: THREE.WebGLRenderer | null = null
let scene: THREE.Scene | null = null
let rig: CameraRig | null = null
let lighting: Lighting | null = null
let built: BuiltScene | null = null
let frame = 0
let observer: ResizeObserver | null = null

/** Ceilings are left out: they turn a top view into a view of a ceiling. */
const model = computed<SceneModel>(() =>
  extrudePlan(
    {
      walls: store.walls,
      openings: store.openings,
      structural: store.structural,
      layers: store.layers,
      background: store.background,
      roomAssignments: store.document.roomAssignments,
    },
    store.rooms,
  ),
)

const extentOf = (source: SceneModel) => {
  const bounds = source.bounds
  if (!bounds) return { centre: new THREE.Vector3(0, 1.5, 0), radius: 6 }

  const centre = new THREE.Vector3(
    (bounds.min.x + bounds.max.x) / 2,
    (bounds.min.y + bounds.max.y) / 2,
    (bounds.min.z + bounds.max.z) / 2,
  )
  const radius = Math.max(
    2,
    Math.hypot(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z) / 2,
  )
  return { centre, radius }
}

function rebuild() {
  if (!scene) return

  if (built) {
    scene.remove(built.root)
    disposeScene(built)
  }
  built = buildScene(model.value)
  scene.add(built.root)
  drawCalls.value = built.drawCalls
  for (const [surface, colour] of chosen.value) applyFinish(built, surface, colour)

  const extent = extentOf(model.value)
  rig?.focus(extent.centre, extent.radius)
}

function resize() {
  const element = host.value
  if (!element || !renderer) return

  const { width, height } = element.getBoundingClientRect()
  renderer.setSize(width, height, false)
  // Capped at 2: beyond that the pixels are invisible and the fill rate is not.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  rig?.resize(width, height)
}

onMounted(() => {
  const element = host.value
  if (!element) return

  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  element.append(renderer.domElement)

  scene = new THREE.Scene()
  lighting = createLighting(renderer, scene)
  scene.add(lighting.group)
  lighting.apply(preset.value)

  rig = createCameraRig(element, renderer, extentOf(model.value))
  rig.setMode(mode.value)
  rebuild()
  resize()

  observer = new ResizeObserver(resize)
  observer.observe(element)

  let previous = performance.now()
  let smoothed = 60

  const loop = () => {
    frame = requestAnimationFrame(loop)
    if (!renderer || !scene || !rig) return

    const now = performance.now()
    const delta = Math.min(0.05, (now - previous) / 1000)
    previous = now
    // Smoothed, because a raw per-frame figure is unreadable — and because
    // docs/08 §8.4 wants a quality tier driven by SUSTAINED framerate, which
    // this is the first half of.
    smoothed += ((delta > 0 ? 1 / delta : 60) - smoothed) * 0.05
    fps.value = Math.round(smoothed)

    rig.update(delta, built?.colliders ?? [])
    renderer.render(scene, rig.camera)
  }
  loop()
})

onBeforeUnmount(() => {
  cancelAnimationFrame(frame)
  observer?.disconnect()
  rig?.dispose()
  lighting?.dispose()
  if (built) disposeScene(built)
  renderer?.dispose()
  renderer?.domElement.remove()
  renderer = null
  scene = null
})

watch(model, rebuild)
watch(mode, (next) => rig?.setMode(next))
watch(preset, (next) => lighting?.apply(next))

const objectCount = computed(() => solidCount(model.value))

/**
 * A finish change repaints the material and nothing else. docs/08 §8.3
 *
 * The chosen colour is remembered so a rebuild — a wall moved while the panel
 * is open — does not silently revert the room to plaster.
 */
const chosen = ref(new Map<DrawnSurface, number>())

function onApply(surface: DrawnSurface, colour: number) {
  chosen.value.set(surface, colour)
  if (built) applyFinish(built, surface, colour)
}
</script>

<template>
  <section class="viewer">
    <header class="viewer__bar">
      <div class="viewer__group" role="group" :aria-label="t('viewer.cameras')">
        <button
          v-for="option in CAMERA_MODES"
          :key="option"
          type="button"
          class="viewer__button"
          :class="{ 'viewer__button--active': mode === option }"
          :aria-pressed="mode === option"
          @click="mode = option"
        >
          {{ t(`viewer.camera.${option}`) }}
        </button>
      </div>

      <div class="viewer__group" role="group" :aria-label="t('viewer.lighting')">
        <button
          v-for="option in LIGHTING_PRESETS"
          :key="option"
          type="button"
          class="viewer__button"
          :class="{ 'viewer__button--active': preset === option }"
          :aria-pressed="preset === option"
          @click="preset = option"
        >
          {{ t(`viewer.light.${option}`) }}
        </button>
      </div>

      <p class="viewer__stats">
        {{ t('viewer.stats', { solids: objectCount, calls: drawCalls, fps }) }}
      </p>
    </header>

    <div ref="host" class="viewer__stage" />

    <FinishPanel @apply="onApply" />

    <p v-if="mode === 'walkthrough'" class="viewer__hint">{{ t('viewer.walkHint') }}</p>
    <p v-else-if="objectCount === 0" class="viewer__hint">{{ t('viewer.empty') }}</p>
  </section>
</template>

<style scoped>
.viewer {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: #0f172a;
}

.viewer__bar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: center;
  padding: 0.5rem 0.75rem;
  background: rgb(15 23 42 / 92%);
  color: #e2e8f0;
}

.viewer__group {
  display: flex;
  gap: 0.25rem;
}

.viewer__button {
  padding: 0.3rem 0.7rem;
  border: 1px solid rgb(148 163 184 / 40%);
  border-radius: 0.375rem;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 0.8125rem;
  cursor: pointer;
}

.viewer__button--active {
  background: #2563eb;
  border-color: #2563eb;
  color: #fff;
}

.viewer__stats {
  margin: 0;
  margin-inline-start: auto;
  font-size: 0.75rem;
  color: #94a3b8;
  font-variant-numeric: tabular-nums;
}

.viewer__stage {
  position: relative;
  flex: 1;
  min-height: 0;
  cursor: grab;
}

.viewer__stage :deep(canvas) {
  display: block;
  inline-size: 100%;
  block-size: 100%;
}

.viewer__hint {
  position: absolute;
  inset-block-end: 1rem;
  inset-inline: 0;
  margin: 0;
  text-align: center;
  color: #cbd5e1;
  font-size: 0.8125rem;
  pointer-events: none;
  text-shadow: 0 1px 3px rgb(0 0 0 / 60%);
}
</style>
