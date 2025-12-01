"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireUserId = requireUserId;
const ALLOW_DEV_FALLBACK = process.env.ALLOW_DEV_AUTH === 'true';
const DEV_FALLBACK_USER = process.env.DEV_AUTH_USER ?? 'dev-user';
/**
 * Resolves the caller's identity from the Cognito-provided JWT claims. A dev fallback is
 * available when ALLOW_DEV_FALLBACK is enabled for offline testing.
 */
function requireUserId(event) {
    const claims = event?.requestContext?.authorizer?.jwt?.claims;
    const sub = typeof claims?.sub === 'string' ? claims.sub : undefined;
    if (sub) {
        return sub;
    }
    if (ALLOW_DEV_FALLBACK) {
        const headers = event?.headers ?? {};
        const headerKey = Object.keys(headers).find((key) => key.toLowerCase() === 'x-dev-user');
        const headerUser = headerKey ? headers[headerKey] : undefined;
        if (typeof headerUser === 'string' && headerUser.trim()) {
            return headerUser;
        }
        return DEV_FALLBACK_USER;
    }
    throw new Error('Unauthorized');
}
