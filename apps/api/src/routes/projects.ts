import type { FastifyInstance } from 'fastify'
import { SystemClock, Uuid7Generator, type ProjectId, type UnitId } from '@buildflow/core'
import { assignedProjectIds } from '@buildflow/identity'
import {
  PrismaProjectRepository,
  PrismaUnitRepository,
  ProjectQueries,
  ROOM_TYPES,
  type ProjectStatus,
  type RoomType,
} from '@buildflow/project'
import type { Database } from '@buildflow/database'
import type { Container } from '../container'
import { authenticate, principalOf, requirePermission } from '../plugins/authenticate'
import { problem, statusFor } from '../server'

/**
 * Project, unit and room routes.
 *
 * Two authorization behaviours to notice:
 *  • list endpoints filter by assignment (`assignedProjectIds`), so a site
 *    engineer sees their sites and an owner sees everything — same endpoint.
 *  • fetching a specific resource outside the caller's scope returns 404,
 *    never 403: a 403 confirms the resource exists. docs/07 §12
 */

const clock = new SystemClock()
const ids = new Uuid7Generator()

export function registerProjectRoutes(app: FastifyInstance, c: Container, db: Database): void {
  const projects = new PrismaProjectRepository(db)
  const units = new PrismaUnitRepository(db)
  const queries = new ProjectQueries(db)

  const NOT_FOUND = (id: unknown) => problem('NOT_FOUND', 'Resource not found', 404, id)

  // ── Projects ─────────────────────────────────────────────────────────────

  app.get(
    '/api/v1/projects',
    { preHandler: [authenticate(c), requirePermission('project.view')] },
    async (request) => {
      const principal = principalOf(request)
      const data = await queries.listProjects(assignedProjectIds(principal, 'project'))
      return { data }
    },
  )

  app.post<{
    Body: { code: string; nameEn: string; nameAr: string; currency?: string }
  }>(
    '/api/v1/projects',
    {
      preHandler: [authenticate(c), requirePermission('project.create')],
      schema: {
        body: {
          type: 'object',
          required: ['code', 'nameEn', 'nameAr'],
          properties: {
            code: { type: 'string', minLength: 2, maxLength: 32, pattern: '^[A-Za-z0-9-]+$' },
            nameEn: { type: 'string', minLength: 2, maxLength: 200 },
            nameAr: { type: 'string', minLength: 2, maxLength: 200 },
            currency: { type: 'string', minLength: 3, maxLength: 3 },
          },
        },
      },
    },
    async (request, reply) => {
      const { code, nameEn, nameAr, currency } = request.body

      if (await projects.codeExists(code)) {
        return reply
          .status(409)
          .send(
            problem(
              'PROJECT_CODE_TAKEN',
              'A project with this code already exists',
              409,
              request.id,
            ),
          )
      }

      const id = ids.next<'ProjectId'>()
      await projects.create({
        id,
        companyId: principalOf(request).companyId,
        code,
        nameEn,
        nameAr,
        clientId: null,
        status: 'planned',
        currency: currency ?? 'SAR',
        holdReason: null,
        version: 0,
      })
      return reply.status(201).send({ id, code, status: 'planned' })
    },
  )

  app.post<{
    Params: { projectId: string }
    Body: { status: ProjectStatus; reason?: string }
  }>(
    '/api/v1/projects/:projectId/status',
    {
      preHandler: [
        authenticate(c),
        requirePermission('project.change_status', (req) => ({
          projectId: (req.params as { projectId: string }).projectId as ProjectId,
        })),
      ],
      schema: {
        body: {
          type: 'object',
          required: ['status'],
          properties: {
            status: {
              enum: ['planned', 'in_progress', 'on_hold', 'completed', 'delivered', 'cancelled'],
            },
            reason: { type: 'string', maxLength: 500 },
          },
        },
      },
    },
    async (request, reply) => {
      const project = await projects.findById(request.params.projectId as ProjectId)
      if (!project) return reply.status(404).send(NOT_FOUND(request.id))

      const principal = principalOf(request)
      const result = project.changeStatus(
        request.body.status,
        principal.userId,
        clock,
        request.body.reason,
      )
      if (result.isErr()) {
        return reply
          .status(statusFor(result.error))
          .send(
            problem(result.error.code, result.error.message, statusFor(result.error), request.id),
          )
      }
      await projects.save(project)
      return { id: project.id, status: project.status }
    },
  )

  // ── Units ────────────────────────────────────────────────────────────────

  app.get<{ Params: { projectId: string } }>(
    '/api/v1/projects/:projectId/units',
    { preHandler: [authenticate(c), requirePermission('unit.view')] },
    async (request) => {
      const principal = principalOf(request)
      const data = await queries.listUnits(
        request.params.projectId as ProjectId,
        assignedProjectIds(principal, 'unit'),
      )
      return { data }
    },
  )

  app.post<{
    Params: { projectId: string }
    Body: {
      unitNumber: string
      name: string
      floor?: number
      grossArea: string
      ceilingHeightMm?: number
      handoverCondition?: 'red_brick' | 'semi_finished' | 'fully_finished_renovation'
    }
  }>(
    '/api/v1/projects/:projectId/units',
    {
      preHandler: [
        authenticate(c),
        requirePermission('unit.create', (req) => ({
          projectId: (req.params as { projectId: string }).projectId as ProjectId,
        })),
      ],
      schema: {
        body: {
          type: 'object',
          required: ['unitNumber', 'name', 'grossArea'],
          properties: {
            unitNumber: { type: 'string', minLength: 1, maxLength: 32 },
            name: { type: 'string', minLength: 1, maxLength: 200 },
            floor: { type: 'integer', minimum: -5, maximum: 200 },
            // Money-adjacent decimals travel as strings, per the API contract.
            grossArea: { type: 'string', pattern: '^\\d{1,6}(\\.\\d{1,4})?$' },
            ceilingHeightMm: { type: 'integer', minimum: 2000, maximum: 10000 },
            handoverCondition: {
              enum: ['red_brick', 'semi_finished', 'fully_finished_renovation'],
            },
          },
        },
      },
    },
    async (request, reply) => {
      const projectId = request.params.projectId as ProjectId
      const project = await projects.findById(projectId)
      // 404, not 403: the id may belong to another tenant, and the response
      // must be indistinguishable from "never existed".
      if (!project) return reply.status(404).send(NOT_FOUND(request.id))

      if (await units.unitNumberExists(projectId, request.body.unitNumber)) {
        return reply
          .status(409)
          .send(
            problem(
              'UNIT_NUMBER_TAKEN',
              'This unit number already exists in the project',
              409,
              request.id,
            ),
          )
      }

      const id = ids.next<'UnitId'>()
      await units.create({
        id,
        companyId: principalOf(request).companyId,
        projectId,
        ownerClientId: null,
        unitNumber: request.body.unitNumber,
        name: request.body.name,
        floor: request.body.floor ?? null,
        grossArea: request.body.grossArea,
        ceilingHeightMm: request.body.ceilingHeightMm ?? 3000,
        handoverCondition: request.body.handoverCondition ?? 'red_brick',
        status: 'planned',
        currency: project.currency,
        rooms: [],
        version: 0,
      })
      return reply.status(201).send({ id, unitNumber: request.body.unitNumber })
    },
  )

  // ── Rooms ────────────────────────────────────────────────────────────────

  app.post<{
    Params: { unitId: string }
    Body: {
      typeCode: RoomType
      nameEn: string
      nameAr: string
      widthMm: number
      lengthMm: number
      heightMm?: number
    }
  }>(
    '/api/v1/units/:unitId/rooms',
    {
      preHandler: [authenticate(c), requirePermission('unit.update')],
      schema: {
        body: {
          type: 'object',
          required: ['typeCode', 'nameEn', 'nameAr', 'widthMm', 'lengthMm'],
          properties: {
            typeCode: { enum: [...ROOM_TYPES] },
            nameEn: { type: 'string', minLength: 1, maxLength: 120 },
            nameAr: { type: 'string', minLength: 1, maxLength: 120 },
            widthMm: { type: 'integer' },
            lengthMm: { type: 'integer' },
            heightMm: { type: 'integer' },
          },
        },
      },
    },
    async (request, reply) => {
      const unit = await units.findById(request.params.unitId as UnitId)
      if (!unit) return reply.status(404).send(NOT_FOUND(request.id))

      const principal = principalOf(request)
      const result = unit.addRoom(
        {
          id: ids.next<'RoomId'>(),
          typeCode: request.body.typeCode,
          nameEn: request.body.nameEn,
          nameAr: request.body.nameAr,
          widthMm: request.body.widthMm,
          lengthMm: request.body.lengthMm,
          ...(request.body.heightMm !== undefined ? { heightMm: request.body.heightMm } : {}),
        },
        principal.userId,
        clock,
      )
      if (result.isErr()) {
        return reply
          .status(statusFor(result.error))
          .send(
            problem(result.error.code, result.error.message, statusFor(result.error), request.id),
          )
      }
      await units.save(unit)

      const room = result.value
      return reply.status(201).send({
        id: room.id,
        typeCode: room.typeCode,
        geometry: room.geometry(),
        // Surfaced so the client can warn — the server does not reject this;
        // corridors and wall thickness make exact area equality unrealistic.
        roomAreaExceedsGross: unit.roomAreaExceedsGross(),
      })
    },
  )

  app.get<{ Params: { unitId: string } }>(
    '/api/v1/units/:unitId',
    { preHandler: [authenticate(c), requirePermission('unit.view')] },
    async (request, reply) => {
      const unit = await units.findById(request.params.unitId as UnitId)
      if (!unit) return reply.status(404).send(NOT_FOUND(request.id))
      const snapshot = unit.toSnapshot()
      return {
        id: snapshot.id,
        projectId: snapshot.projectId,
        unitNumber: snapshot.unitNumber,
        name: snapshot.name,
        floor: snapshot.floor,
        grossArea: snapshot.grossArea,
        status: snapshot.status,
        handoverCondition: snapshot.handoverCondition,
        rooms: unit.rooms.map((room) => ({
          id: room.id,
          typeCode: room.typeCode,
          nameEn: room.nameEn,
          nameAr: room.nameAr,
          widthMm: room.widthMm,
          lengthMm: room.lengthMm,
          heightMm: room.heightMm,
          geometry: room.geometry(),
        })),
        roomAreaExceedsGross: unit.roomAreaExceedsGross(),
      }
    },
  )
}
