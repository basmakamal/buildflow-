<script setup lang="ts">
import { onMounted } from 'vue'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()

// Applied on mount so <html dir> matches the store from the first paint —
// otherwise the first render flashes in the wrong direction.
onMounted(() => {
  ui.setLocale(ui.locale)
  ui.setTheme(ui.theme)
})
</script>

<template>
  <RouterView />
</template>
