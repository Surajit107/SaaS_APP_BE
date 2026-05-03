/**
 * Returns true when the error indicates MongoDB transactions are unavailable
 * (standalone node or version too old — no replica-set / session support).
 * Used to trigger compensating-transaction fallback paths.
 */
export function isTransactionUnavailableError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes('transaction numbers are only allowed') ||
    (msg.includes('transaction') && msg.includes('replica set'))
  );
}
