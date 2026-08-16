/**
 * Project module — PUBLIC CONTRACT. docs/03 §6.1
 */
export {
  Project,
  PROJECT_TRANSITIONS,
  type ProjectSnapshot,
  type ProjectStatus,
} from './domain/project'
export { Unit, type UnitSnapshot, type UnitStatus, type HandoverCondition } from './domain/unit'
export {
  Room,
  ROOM_TYPES,
  isRoomType,
  deriveGeometry,
  type RoomType,
  type RoomProps,
  type RoomGeometry,
} from './domain/room'
export {
  PrismaProjectRepository,
  PrismaUnitRepository,
  ProjectQueries,
  type ProjectRepository,
  type UnitRepository,
} from './infrastructure/prisma.repositories'
