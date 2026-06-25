/**
 * Web-side re-export of the shared client-event sanitizer. The canonical
 * implementation lives in `@exam/contracts` so the web logger and the API
 * route share one definition and cannot drift. See
 * {@link sanitizeClientEvent} there for behavior.
 */
export { sanitizeClientEvent, sanitizeMetadata } from "@exam/contracts";
