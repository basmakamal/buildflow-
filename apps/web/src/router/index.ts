import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/dashboard' },
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
      meta: { public: true },
    },
    {
      path: '/dashboard',
      name: 'dashboard',
      component: () => import('@/views/DashboardView.vue'),
    },
    {
      path: '/projects',
      name: 'projects',
      component: () => import('@/views/ProjectsView.vue'),
    },
    {
      path: '/projects/:projectId/units',
      name: 'units',
      component: () => import('@/views/UnitsView.vue'),
    },
    {
      path: '/units/:unitId/board',
      name: 'unit-board',
      component: () => import('@/views/UnitBoardView.vue'),
    },
    {
      // The planner is heavy — Konva plus the scene — so it is split out and
      // never downloaded by a user who does not open a plan. docs/08 §4
      path: '/units/:unitId/planner',
      name: 'unit-planner',
      component: () => import('@/views/PlannerView.vue'),
    },
    {
      path: '/units/:unitId/invoices',
      name: 'unit-invoices',
      component: () => import('@/views/UnitInvoicesView.vue'),
    },
    {
      path: '/settings/tax-identity',
      name: 'company-tax-identity',
      component: () => import('@/views/CompanySettingsView.vue'),
    },
    {
      path: '/units/:unitId/review',
      name: 'unit-review',
      component: () => import('@/views/UnitReviewView.vue'),
    },
    {
      path: '/knowledge/rules',
      name: 'rule-library',
      component: () => import('@/views/RuleLibraryView.vue'),
    },
    {
      // Route-level code splitting: a user who never opens the icon library
      // never downloads it. docs/08 §4
      path: '/icons',
      name: 'icons',
      component: () => import('@/views/IconsView.vue'),
    },
  ],
})

/**
 * Auth guard.
 *
 * A client-side redirect for UX only. Every protected endpoint enforces
 * authorisation server-side, so bypassing this guard shows an empty shell
 * rather than data. docs/11 §3.1
 */
router.beforeEach((to) => {
  const auth = useAuthStore()
  if (to.meta['public']) return true
  if (!auth.isAuthenticated) return { name: 'login', query: { redirect: to.fullPath } }
  return true
})
