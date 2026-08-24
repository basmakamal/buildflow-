import type { OutboxPublisher, OutboxRow } from '@buildflow/database'

/**
 * Placeholder transport until BullMQ lands. docs/03 §8.2
 *
 * The same deliberate pattern as the SecurityAlerter placeholder in the API
 * container: the seam is real, the adapter is temporary. "Published" here
 * means handed to the operator log as one structured line per event — which
 * is a genuine destination someone watches, not a black hole. Swapping this
 * class for a BullMQ enqueuer is the entire migration; the relay, the outbox,
 * and every producer stay untouched.
 */
export class LogOutboxPublisher implements OutboxPublisher {
  publish(event: OutboxRow): Promise<void> {
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        msg: 'outbox.event',
        eventId: event.id,
        eventType: event.eventType,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        companyId: event.companyId,
        occurredAt: event.occurredAt,
        payload: event.payload,
      }),
    )
    return Promise.resolve()
  }
}
