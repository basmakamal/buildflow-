import { z } from 'zod'
import { createDatabase, runWithoutTenantScope } from '@buildflow/database'
import { buildServer } from './server'
import { createContainer } from './container'

/**
 * API entry point.
 *
 * Environment is validated at boot; the process refuses to start on a missing
 * or invalid value rather than failing at 3 a.m. on the first request that
 * needed it. docs/06 §11
 */
const env = z
  .object({
    DATABASE_URL: z.string().url(),
    JWT_ACCESS_SECRET: z.string().min(32),
    PORT: z.coerce.number().default(3000),
    HOST: z.string().default('127.0.0.1'),
    LOG: z.coerce.boolean().default(true),
  })
  .parse(process.env)

async function main(): Promise<void> {
  const db = createDatabase({ url: env.DATABASE_URL })
  const container = createContainer({ db, jwtSecret: env.JWT_ACCESS_SECRET })
  const app = await buildServer({ container, db, logger: env.LOG })

  await app.listen({ port: env.PORT, host: env.HOST })
  // eslint-disable-next-line no-console
  console.log(`buildflow api listening on http://${env.HOST}:${String(env.PORT)}`)

  const shutdown = async () => {
    await app.close()
    await runWithoutTenantScope(
      { userId: null, requestId: 'shutdown', source: 'system', locale: 'en' },
      () => db.$disconnect(),
    )
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())
}

main().catch((error: unknown) => {
  console.error('boot failed', error)
  process.exit(1)
})
