"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireUserId = requireUserId;
const DEV_MODE = process.env['ALLOW_DEV_AUTH'] === 'true';
const DEV_USER = process.env['DEV_AUTH_USER'] || 'dev-user';
function requireUserId(event) {
    const authorizerContext = event.requestContext?.authorizer;
    const jwt = authorizerContext?.jwt;
    const claims = jwt?.claims ?? {};
    const userId = claims['sub'] || claims['username'];
    if (userId) {
        return userId;
    }
    if (DEV_MODE) {
        return DEV_USER;
    }
    throw new Error('Unauthorized');
}
