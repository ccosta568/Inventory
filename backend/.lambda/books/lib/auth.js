"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireUserId = requireUserId;
/**
 * TEMP DEV AUTH:
 *  - Accepts an optional `x-dev-user` header to scope data locally.
 *  - Falls back to `dev-user` when no header/JWT is present.
 *  - TODO: Replace with proper Cognito JWT validation once authorizer is re-enabled.
 */
function requireUserId(event) {
    const headers = event?.headers ?? {};
    const headerKey = Object.keys(headers).find((key) => key.toLowerCase() === 'x-dev-user');
    const headerUser = headerKey ? headers[headerKey] : undefined;
    if (headerUser) {
        return headerUser;
    }
    const ctx = event?.requestContext;
    const jwt = ctx?.authorizer?.jwt;
    if (!jwt?.claims) {
        return 'dev-user';
    }
    console.log('Auth context:', JSON.stringify(ctx?.authorizer ?? {}, null, 2));
    const rawEmail = jwt.claims.email ??
        jwt.claims['cognito:username'] ??
        jwt.claims.username;
    const email = rawEmail?.toLowerCase();
    console.log('JWT email claim:', email ?? 'n/a');
    const sub = jwt.claims.sub;
    return sub ?? email ?? 'unknown-user';
}
