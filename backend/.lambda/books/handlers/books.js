"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const uuid_1 = require("uuid");
const dynamo_1 = __importStar(require("../lib/dynamo"));
const auth_1 = require("../lib/auth");
const http_1 = require("../lib/http");
const keys_1 = require("../lib/keys");
function parseBody(event) {
    if (!event.body)
        return null;
    try {
        return JSON.parse(event.body);
    }
    catch (err) {
        console.error('Failed to parse body', err);
        return null;
    }
}
function toClientBook(item) {
    if (!item)
        return null;
    return {
        id: item.bookId,
        title: item.title,
        format: item.format,
        price: item.price,
        copiesOnHand: item.copiesOnHand ?? 0,
        notes: item.notes,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt
    };
}
async function listBooks(ownerId) {
    const res = await dynamo_1.default.query({
        TableName: dynamo_1.TABLE_NAME,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: {
            ':pk': (0, keys_1.bookPartition)(ownerId)
        }
    }).promise();
    const books = (res.Items || []).map((item) => toClientBook(item));
    return (0, http_1.ok)(books);
}
async function createBook(ownerId, event) {
    const payload = parseBody(event);
    if (!payload || !payload.title) {
        return (0, http_1.badRequest)('Title is required');
    }
    const now = new Date().toISOString();
    const bookId = (0, uuid_1.v4)();
    const item = {
        PK: (0, keys_1.bookPartition)(ownerId),
        SK: (0, keys_1.bookSortKey)(bookId),
        entityType: 'BOOK',
        ownerId,
        bookId,
        title: payload.title,
        format: payload.format ?? 'paperback',
        price: payload.price,
        copiesOnHand: payload.copiesOnHand ?? 0,
        notes: payload.notes,
        createdAt: now,
        updatedAt: now
    };
    await dynamo_1.default
        .put({
        TableName: dynamo_1.TABLE_NAME,
        Item: item
    })
        .promise();
    return (0, http_1.created)(toClientBook(item));
}
async function updateBook(ownerId, bookId, event) {
    const payload = parseBody(event) || {};
    const updates = [];
    const names = {};
    const values = {};
    const now = new Date().toISOString();
    const allowed = ['title', 'format', 'price', 'copiesOnHand', 'notes'];
    for (const key of allowed) {
        if (payload[key] !== undefined) {
            updates.push(`#${key} = :${key}`);
            names[`#${key}`] = key;
            values[`:${key}`] = payload[key];
        }
    }
    updates.push('#updatedAt = :updatedAt');
    names['#updatedAt'] = 'updatedAt';
    values[':updatedAt'] = now;
    const res = await dynamo_1.default
        .update({
        TableName: dynamo_1.TABLE_NAME,
        Key: {
            PK: (0, keys_1.bookPartition)(ownerId),
            SK: (0, keys_1.bookSortKey)(bookId)
        },
        UpdateExpression: 'SET ' + updates.join(', '),
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: 'ALL_NEW'
    })
        .promise();
    return (0, http_1.ok)(toClientBook(res.Attributes));
}
async function adjustStock(ownerId, bookId, event) {
    const payload = parseBody(event);
    const delta = Number(payload?.delta ?? 0);
    if (!Number.isFinite(delta) || delta === 0) {
        return (0, http_1.badRequest)('delta must be a non-zero number');
    }
    const res = await dynamo_1.default
        .update({
        TableName: dynamo_1.TABLE_NAME,
        Key: {
            PK: (0, keys_1.bookPartition)(ownerId),
            SK: (0, keys_1.bookSortKey)(bookId)
        },
        UpdateExpression: 'SET copiesOnHand = if_not_exists(copiesOnHand, :zero) + :delta, #updatedAt = :updatedAt',
        ConditionExpression: 'attribute_exists(PK)',
        ExpressionAttributeNames: { '#updatedAt': 'updatedAt' },
        ExpressionAttributeValues: {
            ':delta': delta,
            ':updatedAt': new Date().toISOString(),
            ':zero': 0
        },
        ReturnValues: 'ALL_NEW'
    })
        .promise();
    return (0, http_1.ok)(toClientBook(res.Attributes));
}
const handler = async (event) => {
    try {
        const ownerId = (0, auth_1.requireUserId)(event);
        const method = event.requestContext.http.method.toUpperCase();
        const path = event.rawPath || '';
        const bookId = event.pathParameters?.['id'];
        if (method === 'GET' && path === '/books') {
            return await listBooks(ownerId);
        }
        if (method === 'POST' && path === '/books') {
            return await createBook(ownerId, event);
        }
        if (method === 'PUT' && bookId) {
            return await updateBook(ownerId, bookId, event);
        }
        if (method === 'POST' && bookId && path.endsWith('/adjust-stock')) {
            return await adjustStock(ownerId, bookId, event);
        }
        return (0, http_1.badRequest)('Unsupported route');
    }
    catch (err) {
        console.error('books handler error', err);
        const message = err?.message || 'Internal error';
        if (message === 'Unauthorized') {
            return (0, http_1.unauthorized)();
        }
        return (0, http_1.serverError)(message);
    }
};
exports.handler = handler;
