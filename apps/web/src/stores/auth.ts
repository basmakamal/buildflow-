import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { request, setAccessToken } from '@/api/client'

/**
 * Authentication state.
 *
 * The permission set lives here so the UI can hide what the user cannot do.
 * That is honesty in the interface, NOT security — every action is authorised
 * again server-side, so a tampered store changes what is displayed and nothing
 * about what is permitted. docs/11 §3.1
 */
export const useAuthStore = defineStore('auth', () => {
  const userId = ref<string | null>(null)
  const companyId = ref<string | null>(null)
  const permissions = ref<ReadonlySet<string>>(new Set())
  const capabilities = ref({ canSeeCost: false, canSeeMargin: false })
  const isLoading = ref(false)
  const errorCode = ref<string | null>(null)

  const isAuthenticated = computed(() => userId.value !== null)

  /** Mirrors the server-side check so the UI can hide unavailable actions. */
  const can = (permission: string): boolean => permissions.value.has(permission)

  async function login(input: { companyId: string; email: string; password: string }) {
    isLoading.value = true
    errorCode.value = null

    const result = await request<{ accessToken: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(input),
    })

    if (!result.ok) {
      errorCode.value = result.error.code
      isLoading.value = false
      return false
    }

    setAccessToken(result.data.accessToken)
    await loadProfile()
    isLoading.value = false
    return true
  }

  async function loadProfile() {
    const result = await request<{
      userId: string
      companyId: string
      permissions: string[]
      capabilities: { canSeeCost: boolean; canSeeMargin: boolean }
    }>('/auth/me')

    if (!result.ok) return false
    userId.value = result.data.userId
    companyId.value = result.data.companyId
    permissions.value = new Set(result.data.permissions)
    capabilities.value = result.data.capabilities
    return true
  }

  async function logout() {
    await request('/auth/logout', { method: 'POST' })
    setAccessToken(null)
    userId.value = null
    companyId.value = null
    permissions.value = new Set()
    capabilities.value = { canSeeCost: false, canSeeMargin: false }
  }

  return {
    userId,
    companyId,
    permissions,
    capabilities,
    isLoading,
    errorCode,
    isAuthenticated,
    can,
    login,
    loadProfile,
    logout,
  }
})
