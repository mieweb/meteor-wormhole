/**
 * Per-invocation context for methods called through Wormhole transports
 * (REST bridge, MCP bridge).
 *
 * Problem: `Meteor.callAsync` gives the method no access to the originating
 * HTTP request, so callers historically had to smuggle credentials into the
 * JSON body — leaking tokens into OpenAPI examples, MCP traces, and logs.
 *
 * Solution: each bridge runs the method call inside an AsyncLocalStorage
 * scope carrying transport metadata and the parsed `Authorization` header.
 * Method code (or an auth helper) reads it via `Wormhole.currentInvocation()`
 * or `Wormhole.currentBearerToken()`.
 *
 * Outside a Wormhole transport (plain DDP calls), the context is undefined.
 */
import { AsyncLocalStorage } from 'async_hooks';

const storage = new AsyncLocalStorage();

/**
 * @typedef {object} WormholeInvocation
 * @property {'rest'|'mcp'} transport - Which bridge invoked the method
 * @property {string|null} bearerToken - Token from `Authorization: Bearer …`, or null
 * @property {object} headers - Raw request headers (lower-cased keys, Node style)
 * @property {string|null} methodName - The Meteor method being invoked
 */

/**
 * Extract the bearer token from an Authorization header value.
 * @param {string|undefined} headerValue
 * @returns {string|null}
 */
export function parseBearerToken(headerValue) {
  if (typeof headerValue !== 'string') return null;
  const match = /^Bearer\s+(.+)$/i.exec(headerValue.trim());
  return match ? match[1] : null;
}

/**
 * Run `fn` inside an invocation context built from an HTTP request.
 * @param {{transport: 'rest'|'mcp', req: import('http').IncomingMessage, methodName?: string}} input
 * @param {Function} fn - Async function to run within the context
 * @returns {Promise<*>}
 */
export function runWithInvocation({ transport, req, methodName = null }, fn) {
  const headers = (req && req.headers) || {};
  /** @type {WormholeInvocation} */
  const invocation = {
    transport,
    bearerToken: parseBearerToken(headers['authorization']),
    headers,
    methodName,
  };
  return storage.run(invocation, fn);
}

/**
 * The current Wormhole invocation context, or undefined when the method was
 * not called through a Wormhole transport (e.g. plain DDP).
 * @returns {WormholeInvocation|undefined}
 */
export function currentInvocation() {
  return storage.getStore();
}

/**
 * Convenience: the caller's bearer token for the current invocation, or null.
 * @returns {string|null}
 */
export function currentBearerToken() {
  return currentInvocation()?.bearerToken ?? null;
}
