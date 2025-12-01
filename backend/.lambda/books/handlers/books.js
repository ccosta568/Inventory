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
function normalizeValue(value) {
    return (value ?? '').trim().toLowerCase();
}
function normalizeFormat(value) {
    return value ? value.trim().toLowerCase() : 'paperback';
}
function buildIdentityKey(title, author, format) {
    return `${normalizeValue(title)}|${normalizeValue(author)}|${normalizeFormat(format)}`;
}
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
function toClientTier(item) {
    if (!item?.tierId)
        return null;
    return {
        bookId: item.bookId,
        tierId: item.tierId,
        price: Number(item.price ?? 0),
        copiesOnHand: Number(item.copiesOnHand ?? 0),
        notes: item.notes ?? '',
        createdAt: item.createdAt,
        updatedAt: item.updatedAt
    };
}
function legacyTierFromBook(item) {
    if (!item)
        return null;
    const copies = Number(item.copiesOnHand ?? 0);
    const price = Number(item.price ?? 0);
    if (!copies && !price && !item.notes) {
        return null;
    }
    return {
        bookId: item.bookId,
        tierId: item.bookId,
        price,
        copiesOnHand: copies,
        notes: item.notes ?? '',
        createdAt: item.createdAt,
        updatedAt: item.updatedAt
    };
}
function toClientBook(item, tiers = []) {
    if (!item)
        return null;
    const mapped = tiers
        .map((tier) => toClientTier(tier))
        .filter((tier) => !!tier);
    if (!mapped.length) {
        const fallback = legacyTierFromBook(item);
        if (fallback) {
            mapped.push(fallback);
        }
    }
    const totalOnHand = mapped.reduce((sum, tier) => sum + tier.copiesOnHand, 0);
    return {
        id: item.bookId,
        title: item.title,
        author: item.author,
        format: item.format ?? 'paperback',
        notes: item.notes ?? '',
        priceTiers: mapped,
        totalOnHand,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt
    };
}
async function loadBook(ownerId, bookId) {
    const res = await dynamo_1.default
        .query({
        TableName: dynamo_1.TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
            ':pk': (0, keys_1.bookPartition)(ownerId),
            ':sk': (0, keys_1.bookSortKey)(bookId)
        }
    })
        .promise();
    if (!res.Items?.length) {
        return null;
    }
    let bookRecord;
    const tiers = [];
    for (const item of res.Items) {
        if (item.entityType === 'BOOK') {
            bookRecord = item;
        }
        else if (item.entityType === 'BOOK_TIER') {
            tiers.push(item);
        }
    }
    return toClientBook(bookRecord, tiers);
}
function bookIdentityKeyFromRecord(item) {
    if (item.normalizedTitle || item.normalizedAuthor || item.normalizedFormat) {
        return buildIdentityKey(item.normalizedTitle, item.normalizedAuthor, item.normalizedFormat);
    }
    return buildIdentityKey(item.title, item.author, item.format);
}
async function findBookByIdentity(ownerId, identityKey) {
    const res = await dynamo_1.default
        .query({
        TableName: dynamo_1.TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
            ':pk': (0, keys_1.bookPartition)(ownerId),
            ':sk': 'BOOK#'
        }
    })
        .promise();
    for (const item of res.Items || []) {
        const record = item;
        if (bookIdentityKeyFromRecord(record) === identityKey) {
            return record;
        }
    }
    return null;
}
async function mergeIntoExistingBook(ownerId, existing, tierPrice, copies, tierNotes) {
    const tier = await findTierByPrice(ownerId, existing.bookId, tierPrice);
    const now = new Date().toISOString();
    if (tier) {
        await dynamo_1.default
            .update({
            TableName: dynamo_1.TABLE_NAME,
            Key: {
                PK: (0, keys_1.bookPartition)(ownerId),
                SK: (0, keys_1.tierSortKey)(existing.bookId, tier.tierId)
            },
            UpdateExpression: 'SET copiesOnHand = if_not_exists(copiesOnHand, :zero) + :copies, #updatedAt = :updatedAt',
            ExpressionAttributeNames: { '#updatedAt': 'updatedAt' },
            ExpressionAttributeValues: {
                ':copies': copies,
                ':zero': 0,
                ':updatedAt': now
            }
        })
            .promise();
    }
    else {
        const tierId = (0, uuid_1.v4)();
        const newTier = {
            PK: (0, keys_1.bookPartition)(ownerId),
            SK: (0, keys_1.tierSortKey)(existing.bookId, tierId),
            entityType: 'BOOK_TIER',
            ownerId,
            bookId: existing.bookId,
            tierId,
            price: tierPrice,
            copiesOnHand: copies,
            notes: tierNotes,
            createdAt: now,
            updatedAt: now
        };
        await dynamo_1.default
            .put({
            TableName: dynamo_1.TABLE_NAME,
            Item: newTier
        })
            .promise();
    }
    await dynamo_1.default
        .update({
        TableName: dynamo_1.TABLE_NAME,
        Key: {
            PK: (0, keys_1.bookPartition)(ownerId),
            SK: (0, keys_1.bookSortKey)(existing.bookId)
        },
        UpdateExpression: 'SET copiesOnHand = if_not_exists(copiesOnHand, :zero) + :copies, #updatedAt = :updatedAt',
        ExpressionAttributeNames: { '#updatedAt': 'updatedAt' },
        ExpressionAttributeValues: {
            ':copies': copies,
            ':zero': 0,
            ':updatedAt': now
        }
    })
        .promise();
    console.info('book.merge', {
        ownerId,
        bookId: existing.bookId,
        price: tierPrice,
        copies
    });
    return loadBook(ownerId, existing.bookId);
}
async function getTierRecord(ownerId, bookId, tierId) {
    const res = await dynamo_1.default
        .get({
        TableName: dynamo_1.TABLE_NAME,
        Key: {
            PK: (0, keys_1.bookPartition)(ownerId),
            SK: (0, keys_1.tierSortKey)(bookId, tierId)
        }
    })
        .promise();
    if (!res.Item) {
        return null;
    }
    return res.Item;
}
async function findTierByPrice(ownerId, bookId, price) {
    const res = await dynamo_1.default
        .query({
        TableName: dynamo_1.TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeNames: { '#price': 'price' },
        ExpressionAttributeValues: {
            ':pk': (0, keys_1.bookPartition)(ownerId),
            ':prefix': (0, keys_1.tierPrefix)(bookId),
            ':price': price
        },
        FilterExpression: '#price = :price',
        Limit: 1
    })
        .promise();
    if (!res.Items?.length) {
        return null;
    }
    return res.Items[0];
}
async function listBooks(ownerId) {
    const res = await dynamo_1.default
        .query({
        TableName: dynamo_1.TABLE_NAME,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': (0, keys_1.bookPartition)(ownerId) }
    })
        .promise();
    const grouped = new Map();
    for (const item of res.Items || []) {
        const entityType = item.entityType;
        if (entityType === 'BOOK') {
            const entry = grouped.get(item.bookId) || { tiers: [] };
            entry.book = item;
            grouped.set(entry.book.bookId, entry);
        }
        else if (entityType === 'BOOK_TIER') {
            const tier = item;
            if (!tier.bookId)
                continue;
            const entry = grouped.get(tier.bookId) || { tiers: [] };
            entry.tiers.push(tier);
            grouped.set(tier.bookId, entry);
        }
    }
    const books = Array.from(grouped.values())
        .map(({ book, tiers }) => toClientBook(book, tiers))
        .filter((book) => !!book);
    return (0, http_1.ok)(books);
}
async function createBook(ownerId, event) {
    const payload = parseBody(event);
    if (!payload || !payload.title?.trim()) {
        return (0, http_1.badRequest)('Title is required');
    }
    const now = new Date().toISOString();
    const bookId = (0, uuid_1.v4)();
    const copies = Number(payload.copiesOnHand ?? payload.copies ?? 0) || 0;
    const tierPrice = Number(payload.price ?? 0) || 0;
    const tierNotes = payload.tierNotes ?? payload.notes ?? '';
    const identityKey = buildIdentityKey(payload.title, payload.author, payload.format);
    const existingBook = await findBookByIdentity(ownerId, identityKey);
    if (existingBook) {
        const merged = await mergeIntoExistingBook(ownerId, existingBook, tierPrice, copies, tierNotes);
        return (0, http_1.ok)(merged);
    }
    const item = {
        PK: (0, keys_1.bookPartition)(ownerId),
        SK: (0, keys_1.bookSortKey)(bookId),
        entityType: 'BOOK',
        ownerId,
        bookId,
        title: payload.title.trim(),
        author: payload.author?.trim(),
        format: payload.format ?? 'paperback',
        normalizedTitle: normalizeValue(payload.title),
        normalizedAuthor: normalizeValue(payload.author),
        normalizedFormat: normalizeFormat(payload.format),
        price: tierPrice,
        copiesOnHand: copies,
        notes: payload.notes ?? '',
        createdAt: now,
        updatedAt: now
    };
    const tierId = (0, uuid_1.v4)();
    const tier = {
        PK: (0, keys_1.bookPartition)(ownerId),
        SK: (0, keys_1.tierSortKey)(bookId, tierId),
        entityType: 'BOOK_TIER',
        ownerId,
        bookId,
        tierId,
        price: tierPrice,
        copiesOnHand: copies,
        notes: tierNotes,
        createdAt: now,
        updatedAt: now
    };
    await dynamo_1.default
        .put({
        TableName: dynamo_1.TABLE_NAME,
        Item: item
    })
        .promise();
    try {
        await dynamo_1.default
            .put({
            TableName: dynamo_1.TABLE_NAME,
            Item: tier
        })
            .promise();
    }
    catch (err) {
        await dynamo_1.default
            .delete({
            TableName: dynamo_1.TABLE_NAME,
            Key: { PK: (0, keys_1.bookPartition)(ownerId), SK: (0, keys_1.bookSortKey)(bookId) }
        })
            .promise();
        throw err;
    }
    const book = await loadBook(ownerId, bookId);
    return (0, http_1.created)(book ?? toClientBook(item, [tier]));
}
async function updateBook(ownerId, bookId, event) {
    const payload = parseBody(event) || {};
    if (payload.copies !== undefined && payload.copiesOnHand === undefined) {
        payload.copiesOnHand = payload.copies;
    }
    const updates = [];
    const names = {};
    const values = {};
    const now = new Date().toISOString();
    const allowed = ['title', 'author', 'format', 'notes'];
    for (const key of allowed) {
        const value = payload[key];
        if (value !== undefined) {
            const name = `#${key}`;
            const val = `:${key}`;
            updates.push(`${name} = ${val}`);
            names[name] = key;
            values[val] = key === 'title' && typeof value === 'string' ? value.trim() : value;
        }
    }
    if (payload.title !== undefined) {
        updates.push('#normalizedTitle = :normalizedTitle');
        names['#normalizedTitle'] = 'normalizedTitle';
        values[':normalizedTitle'] = normalizeValue(payload.title);
    }
    if (payload.author !== undefined) {
        updates.push('#normalizedAuthor = :normalizedAuthor');
        names['#normalizedAuthor'] = 'normalizedAuthor';
        values[':normalizedAuthor'] = normalizeValue(payload.author);
    }
    if (payload.format !== undefined) {
        updates.push('#normalizedFormat = :normalizedFormat');
        names['#normalizedFormat'] = 'normalizedFormat';
        values[':normalizedFormat'] = normalizeFormat(payload.format);
    }
    if (!updates.length) {
        return (0, http_1.badRequest)('No valid fields to update');
    }
    updates.push('#updatedAt = :updatedAt');
    names['#updatedAt'] = 'updatedAt';
    values[':updatedAt'] = now;
    await dynamo_1.default
        .update({
        TableName: dynamo_1.TABLE_NAME,
        Key: {
            PK: (0, keys_1.bookPartition)(ownerId),
            SK: (0, keys_1.bookSortKey)(bookId)
        },
        UpdateExpression: 'SET ' + updates.join(', '),
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: 'NONE'
    })
        .promise();
    const book = await loadBook(ownerId, bookId);
    if (!book) {
        return (0, http_1.badRequest)('Book not found');
    }
    return (0, http_1.ok)(book);
}
async function deleteBook(ownerId, bookId) {
    const res = await dynamo_1.default
        .query({
        TableName: dynamo_1.TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
            ':pk': (0, keys_1.bookPartition)(ownerId),
            ':sk': (0, keys_1.bookSortKey)(bookId)
        }
    })
        .promise();
    const items = res.Items ?? [];
    if (!items.length) {
        await dynamo_1.default
            .delete({
            TableName: dynamo_1.TABLE_NAME,
            Key: {
                PK: (0, keys_1.bookPartition)(ownerId),
                SK: (0, keys_1.bookSortKey)(bookId)
            }
        })
            .promise();
        return (0, http_1.noContent)();
    }
    while (items.length) {
        const batch = items.splice(0, 25).map((item) => ({
            DeleteRequest: {
                Key: { PK: item.PK, SK: item.SK }
            }
        }));
        await dynamo_1.default
            .batchWrite({
            RequestItems: {
                [dynamo_1.TABLE_NAME]: batch
            }
        })
            .promise();
    }
    return (0, http_1.noContent)();
}
async function adjustStock(ownerId, bookId, event) {
    const payload = parseBody(event);
    const delta = Number(payload?.delta ?? 0);
    if (!Number.isFinite(delta) || delta === 0) {
        return (0, http_1.badRequest)('delta must be a non-zero number');
    }
    const candidateTierId = payload?.tierId ?? event.pathParameters?.['tierId'];
    const price = typeof payload?.price === 'number' ? Number(payload?.price) : undefined;
    let tier = null;
    if (candidateTierId) {
        tier = await getTierRecord(ownerId, bookId, candidateTierId);
    }
    if (!tier && price !== undefined) {
        tier = await findTierByPrice(ownerId, bookId, price);
    }
    if (!tier) {
        return (0, http_1.badRequest)('Tier not found for adjustment');
    }
    await dynamo_1.default
        .update({
        TableName: dynamo_1.TABLE_NAME,
        Key: {
            PK: (0, keys_1.bookPartition)(ownerId),
            SK: (0, keys_1.tierSortKey)(bookId, tier.tierId)
        },
        UpdateExpression: 'SET copiesOnHand = if_not_exists(copiesOnHand, :zero) + :delta, #updatedAt = :updatedAt',
        ExpressionAttributeNames: { '#updatedAt': 'updatedAt' },
        ExpressionAttributeValues: {
            ':delta': delta,
            ':zero': 0,
            ':updatedAt': new Date().toISOString()
        }
    })
        .promise();
    console.info('tier.adjust', {
        ownerId,
        bookId,
        tierId: tier.tierId,
        delta
    });
    const book = await loadBook(ownerId, bookId);
    if (!book) {
        return (0, http_1.badRequest)('Book not found');
    }
    return (0, http_1.ok)(book);
}
async function createTier(ownerId, bookId, event) {
    const payload = parseBody(event);
    if (!payload) {
        return (0, http_1.badRequest)('Invalid tier payload');
    }
    const price = Number(payload.price ?? 0);
    if (!Number.isFinite(price)) {
        return (0, http_1.badRequest)('Price must be a number');
    }
    const copies = Number(payload.copiesOnHand ?? payload.copies ?? 0) || 0;
    const tierNotes = payload.tierNotes ?? payload.notes ?? '';
    const now = new Date().toISOString();
    const tierId = (0, uuid_1.v4)();
    const existing = await loadBook(ownerId, bookId);
    if (!existing) {
        return (0, http_1.badRequest)('Book not found');
    }
    const tier = {
        PK: (0, keys_1.bookPartition)(ownerId),
        SK: (0, keys_1.tierSortKey)(bookId, tierId),
        entityType: 'BOOK_TIER',
        ownerId,
        bookId,
        tierId,
        price,
        copiesOnHand: copies,
        notes: tierNotes,
        createdAt: now,
        updatedAt: now
    };
    await dynamo_1.default
        .put({
        TableName: dynamo_1.TABLE_NAME,
        Item: tier
    })
        .promise();
    console.info('tier.create', { ownerId, bookId, tierId });
    const updated = await loadBook(ownerId, bookId);
    return (0, http_1.created)(updated ?? existing);
}
const handler = async (event) => {
    try {
        const ownerId = (0, auth_1.requireUserId)(event);
        const method = event.requestContext.http?.method?.toUpperCase() ?? '';
        const path = event.rawPath ?? '';
        const bookId = event.pathParameters?.['id'];
        const tierId = event.pathParameters?.['tierId'];
        if (method === 'GET' && path === '/books') {
            return await listBooks(ownerId);
        }
        if (method === 'POST' && path === '/books') {
            return await createBook(ownerId, event);
        }
        if (method === 'PUT' && bookId) {
            return await updateBook(ownerId, bookId, event);
        }
        if (method === 'DELETE' && bookId && !path.endsWith('/adjust-stock')) {
            return await deleteBook(ownerId, bookId);
        }
        if (method === 'POST' && bookId && path.endsWith('/tiers')) {
            return await createTier(ownerId, bookId, event);
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
