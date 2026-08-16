import type { FastifyInstance } from 'fastify'
import { canSeeCost, canSeeMargin } from '@buildflow/identity'
import type { Container } from '../container'
import { authenticate, principalOf } from '../plugins/authenticate'

/**
 * Session and demonstration routes.
 *
 * `/auth/me` is what lets the web and mobile clients hide actions the user
 * cannot perform. It returns the effective permission set precisely so the UI
 * can be honest — never as the thing that enforces it. docs/08 §5
 */
export function registerMeRoutes(app: FastifyInstance, c: Container): void {
  app.get('/api/v1/auth/me', { preHandler: authenticate(c) }, (request) => {
    const principal = principalOf(request)

    return {
      userId: principal.userId,
      companyId: principal.companyId,
      permissions: [...principal.permissions].sort(),
      assignments: principal.assignments,
      capabilities: {
        // Surfaced explicitly because these drive whole-column visibility in
        // the UI, not just a hidden button. docs/11 §3.3
        canSeeCost: canSeeCost(principal),
        canSeeMargin: canSeeMargin(principal),
      },
    }
  })
}
