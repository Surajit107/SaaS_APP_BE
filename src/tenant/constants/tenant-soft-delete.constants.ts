/**
 * Retention after soft-delete before MongoDB TTL removes the tenant document.
 * Override with env `TENANT_PURGE_AFTER_MS` (milliseconds) for demos/tests.
 */
const envMs = Number.parseInt(process.env.TENANT_PURGE_AFTER_MS ?? '', 10);
export const TENANT_SOFT_DELETE_PURGE_AFTER_MS =
  Number.isFinite(envMs) && envMs > 0 ? envMs : 30 * 24 * 60 * 60 * 1000;
