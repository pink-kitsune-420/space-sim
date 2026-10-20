/** Host-only wire protocol compatibility entry (`packages/net`); wire codec is owned by the explicit flight-session package (`modules/session-flight`). Modules cannot import this package (`packages/module-tools/check-boundaries.mjs`); use `FLIGHT_SESSIONS` (`session.flight@1.0.0`). */
export * from '../../../modules/session-flight/src/protocol';
