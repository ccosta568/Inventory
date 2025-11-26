"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ok = ok;
exports.created = created;
exports.noContent = noContent;
exports.badRequest = badRequest;
exports.unauthorized = unauthorized;
exports.serverError = serverError;
const defaultHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
};
function ok(body = {}) {
    return {
        statusCode: 200,
        headers: defaultHeaders,
        body: JSON.stringify(body)
    };
}
function created(body = {}) {
    return {
        statusCode: 201,
        headers: defaultHeaders,
        body: JSON.stringify(body)
    };
}
function noContent() {
    return {
        statusCode: 204,
        headers: defaultHeaders,
        body: ''
    };
}
function badRequest(message) {
    return {
        statusCode: 400,
        headers: defaultHeaders,
        body: JSON.stringify({ message })
    };
}
function unauthorized(message = 'Unauthorized') {
    return {
        statusCode: 401,
        headers: defaultHeaders,
        body: JSON.stringify({ message })
    };
}
function serverError(message) {
    return {
        statusCode: 500,
        headers: defaultHeaders,
        body: JSON.stringify({ message })
    };
}
