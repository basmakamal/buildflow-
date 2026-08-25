import { z } from 'zod'
import { Uuid7Generator } from '@buildflow/core'
import { OutboxRelay, createDatabase, runWithoutTenantScope } from '@buildflow/database'
import { BalanceReconciliation, ShortageSweep } from '@buildflow/catalogue'
import { LogOutboxPublisher } from './log-publisher'

/**
 * Worker entry point — the platform process behind the API. docs/03 §4
 *
 * Two loops, both cross-tenant by design and both guarded by
 * runWithoutTenantScope:
 *
 *   1. The OUTBOX RELAY drains outbox_events every few seconds. This is what
 *      makes the transactional outbox an actual delivery mechanism rather
 *      than a table that fills up — budget.exceeded alerts wait here.
 *   2. The NIGHTLY PASS replays every stock ledger scope against
 *      material_balances, repairs drift, and reports it — the Phase 3 exit
 *      criterion is this job reporting zero drift over 30 days — and then
 *      sweeps for material SHORTAGES against the issued plans. That order is
 *      deliberate: a shortage computed from a drifted projection is a false
 *      alarm, and false alarms are how people learn to ignore real ones.
 *
 * `--once` runs each job exactly once and exits — for cron, CI, and hand
 * verification. Loops never overlap themselves: a tick that finds the
 * previous one still running skips, because two concurrent reconciliations
 * would double-write the same repairs.
 */

const env = z
  .object({
    DATABASE_URL: z.string().url(),
    RELAY_INTERVAL_MS: z.coerce.number().min(1000).default(5_000),
    RECONCILIATION_INTERVAL_MS: z.coerce.number().min(60_000).default(86_400_000),
  })
  .parse(process.env)

const sys = (requestId: string) => ({
  userId: null,
  requestId,
  source: 'system' as const,
  locale: 'en',
})

async function main(): Promise<void> {
  const once = process.argv.includes('--once')
  const db = createDatabase({ url: env.DATABASE_URL })
  const ids = new Uuid7Generator()

  const relay = new OutboxRelay(db, new LogOutboxPublisher())
  const reconciliation = new BalanceReconciliation(db, () => ids.next())
  const shortages = new ShortageSweep(db, () => ids.next())

  const drainOutbox = async (): Promise<void> => {
    const published = await runWithoutTenantScope(sys('outbox-relay'), () => relay.drain())
    if (published > 0) {
      // eslint-disable-next-line no-console
      console.log(JSON.stringify({ msg: 'relay.drained', published }))
    }
  }

  const reconcile = async (): Promise<void> => {
    const summary = await runWithoutTenantScope(sys('reconciliation'), () => reconciliation.run())
    // Zero drift is the number the exit criterion watches, so it is logged
    // even when there is nothing to say — silence is not evidence.
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        msg: 'reconciliation.completed',
        scopesChecked: summary.scopesChecked,
        driftsFound: summary.drifts.length,
        durationMs: summary.finishedAt.getTime() - summary.startedAt.getTime(),
      }),
    )
    for (const drift of summary.drifts) {
      console.error(JSON.stringify({ msg: 'reconciliation.drift', ...drift }))
    }

    // Shortages are checked right after the ledger is known to be true: a
    // shortage computed from a drifted projection is a false alarm, and a
    // false shortage alarm is how people learn to ignore the real ones.
    const shortage = await runWithoutTenantScope(sys('shortage-sweep'), () =>
      shortages.run(new Date()),
    )
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        msg: 'shortage.swept',
        scopesChecked: shortage.scopesChecked,
        shortagesFound: shortage.shortages.length,
        eventsRaised: shortage.raised,
      }),
    )
  }

  if (once) {
    await reconcile()
    await drainOutbox()
    await runWithoutTenantScope(sys('shutdown'), () => db.$disconnect())
    return
  }

  let draining = false
  const relayTimer = setInterval(() => {
    if (draining) return
    draining = true
    drainOutbox()
      .catch((error: unknown) => {
        console.error('relay drain failed', error)
      })
      .finally(() => {
        draining = false
      })
  }, env.RELAY_INTERVAL_MS)

  let reconciling = false
  const runReconciliation = () => {
    if (reconciling) return
    reconciling = true
    reconcile()
      .catch((error: unknown) => {
        console.error('reconciliation failed', error)
      })
      .finally(() => {
        reconciling = false
      })
  }
  // On boot AND on the interval: a worker that restarts nightly would
  // otherwise never reconcile at all.
  runReconciliation()
  const reconciliationTimer = setInterval(runReconciliation, env.RECONCILIATION_INTERVAL_MS)

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      msg: 'worker.started',
      relayIntervalMs: env.RELAY_INTERVAL_MS,
      reconciliationIntervalMs: env.RECONCILIATION_INTERVAL_MS,
    }),
  )

  const shutdown = async () => {
    clearInterval(relayTimer)
    clearInterval(reconciliationTimer)
    await runWithoutTenantScope(sys('shutdown'), () => db.$disconnect())
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())
}

main().catch((error: unknown) => {
  console.error('worker boot failed', error)
  process.exit(1)
})
