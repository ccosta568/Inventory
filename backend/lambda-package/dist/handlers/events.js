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
function toClientEvent(item) {
    if (!item)
        return null;
    return {
        id: item.eventId,
        eventName: item.eventName,
        date: item.date,
        lines: item.lines || [],
        notes: item.notes,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        appliedAt: item.appliedAt
    };
}
async function listEvents(ownerId) {
    const res = await dynamo_1.default
        .query({
        TableName: dynamo_1.TABLE_NAME,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': (0, keys_1.eventPartition)(ownerId) },
        ScanIndexForward: false
    })
        .promise();
    const events = (res.Items || []).map((item) => toClientEvent(item));
    return (0, http_1.ok)(events);
}
async function getEvent(ownerId, eventId) {
    const res = await dynamo_1.default
        .query({
        TableName: dynamo_1.TABLE_NAME,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk AND GSI1SK = :sk',
        ExpressionAttributeValues: {
            ':pk': (0, keys_1.gsiEventMeta)(ownerId, eventId),
            ':sk': keys_1.EVENT_META_GSI_SK
        },
        Limit: 1
    })
        .promise();
    if (!res.Items?.length) {
        return null;
    }
    return res.Items[0];
}
function validateEventInput(payload) {
    if (!payload)
        return false;
    if (!payload.eventName || !payload.date)
        return false;
    if (!Array.isArray(payload.lines))
        return false;
    return payload.lines.every((line) => {
        if (!line.bookId || !Number.isFinite(line.qtySold)) {
            return false;
        }
        if (line.tierId) {
            return true;
        }
        return Number.isFinite(line.price);
    });
}
async function createEvent(ownerId, event) {
    const payload = parseBody(event);
    if (!validateEventInput(payload)) {
        return (0, http_1.badRequest)('Invalid event payload');
    }
    let normalizedLines;
    try {
        normalizedLines = await normalizeEventLines(ownerId, payload.lines);
    }
    catch (err) {
        console.error('Failed to normalize event lines', err);
        return (0, http_1.badRequest)(err?.message || 'Invalid event lines');
    }
    const now = new Date().toISOString();
    const eventId = payload.id || (0, uuid_1.v4)();
    const meta = {
        PK: (0, keys_1.eventPartition)(ownerId),
        SK: (0, keys_1.eventSortKey)(payload.date, eventId),
        entityType: 'EVENT',
        ownerId,
        eventId,
        eventName: payload.eventName,
        date: payload.date,
        lines: normalizedLines,
        notes: payload.notes,
        createdAt: now,
        updatedAt: now
    };
    const items = [
        {
            PutRequest: {
                Item: {
                    ...meta,
                    GSI1PK: (0, keys_1.gsiEventMeta)(ownerId, eventId),
                    GSI1SK: keys_1.EVENT_META_GSI_SK
                }
            }
        }
    ];
    normalizedLines.forEach((line, index) => {
        items.push({
            PutRequest: {
                Item: {
                    PK: (0, keys_1.eventLinePartition)(ownerId, eventId),
                    SK: (0, keys_1.eventLineSortKey)(index, line.bookId),
                    entityType: 'EVENT_LINE',
                    ownerId,
                    eventId,
                    bookId: line.bookId,
                    qtySold: line.qtySold,
                    tierId: line.tierId,
                    price: line.price,
                    revenue: line.revenue,
                    date: payload.date,
                    gsi1pk: (0, keys_1.gsiBookEvent)(ownerId, line.bookId),
                    gsi1sk: (0, keys_1.eventSortKey)(payload.date, eventId)
                }
            }
        });
    });
    while (items.length) {
        const batch = items.splice(0, 25);
        let requestItems = { [dynamo_1.TABLE_NAME]: batch };
        do {
            const res = await dynamo_1.default
                .batchWrite({
                RequestItems: requestItems
            })
                .promise();
            const unprocessed = res.UnprocessedItems?.[dynamo_1.TABLE_NAME];
            if (unprocessed && unprocessed.length) {
                requestItems = { [dynamo_1.TABLE_NAME]: unprocessed };
            }
            else {
                requestItems = { [dynamo_1.TABLE_NAME]: [] };
            }
        } while (requestItems[dynamo_1.TABLE_NAME].length);
    }
    console.info('event.logged', { ownerId, eventId, lineCount: normalizedLines.length });
    return (0, http_1.created)(toClientEvent(meta));
}
async function applyEvent(ownerId, eventId) {
    const eventRecord = await getEvent(ownerId, eventId);
    if (!eventRecord) {
        return (0, http_1.badRequest)('Event not found');
    }
    const lines = (eventRecord.lines || []);
    for (const line of lines) {
        await applyLineToInventory(ownerId, line);
    }
    await dynamo_1.default
        .update({
        TableName: dynamo_1.TABLE_NAME,
        Key: {
            PK: (0, keys_1.eventPartition)(ownerId),
            SK: eventRecord.SK
        },
        UpdateExpression: 'SET appliedAt = :appliedAt',
        ExpressionAttributeValues: {
            ':appliedAt': new Date().toISOString()
        }
    })
        .promise();
    console.info('event.applied', { ownerId, eventId, lineCount: lines.length });
    return (0, http_1.ok)({ message: 'Event applied to inventory' });
}
async function normalizeEventLines(ownerId, lines) {
    const normalized = [];
    for (const line of lines) {
        if (!line.bookId) {
            continue;
        }
        const qty = Math.abs(Number(line.qtySold ?? 0));
        if (!Number.isFinite(qty) || qty <= 0) {
            continue;
        }
        let tierId = line.tierId;
        let price = typeof line.price === 'number' && Number.isFinite(line.price) ? Number(line.price) : undefined;
        if (!tierId && price === undefined) {
            throw new Error('Each sale line must include a tierId or price.');
        }
        if ((price === undefined || Number.isNaN(price)) && tierId) {
            const tier = await getTierRecord(ownerId, line.bookId, tierId);
            if (!tier) {
                throw new Error(`Tier ${tierId} not found for book ${line.bookId}.`);
            }
            price = Number(tier.price ?? 0);
        }
        if (price === undefined || Number.isNaN(price)) {
            throw new Error(`Price missing for sale line on book ${line.bookId}.`);
        }
        normalized.push({
            bookId: line.bookId,
            tierId,
            price,
            qtySold: qty,
            revenue: qty * price
        });
    }
    return normalized;
}
async function applyLineToInventory(ownerId, line) {
    if (!line.bookId || !Number.isFinite(line.qtySold)) {
        return;
    }
    const qty = Math.abs(line.qtySold);
    if (!qty) {
        return;
    }
    if (line.tierId) {
        const applied = await decrementTierCopies(ownerId, line.bookId, line.tierId, qty);
        if (applied) {
            return;
        }
    }
    if (Number.isFinite(line.price)) {
        const tier = await findTierByPrice(ownerId, line.bookId, Number(line.price));
        if (tier && (await decrementTierCopies(ownerId, line.bookId, tier.tierId, qty))) {
            return;
        }
    }
    await decrementLegacyBook(ownerId, line.bookId, qty);
}
async function decrementTierCopies(ownerId, bookId, tierId, qty) {
    try {
        await dynamo_1.default
            .update({
            TableName: dynamo_1.TABLE_NAME,
            Key: {
                PK: (0, keys_1.bookPartition)(ownerId),
                SK: (0, keys_1.tierSortKey)(bookId, tierId)
            },
            UpdateExpression: 'SET copiesOnHand = if_not_exists(copiesOnHand, :zero) - :qty, #updatedAt = :updatedAt',
            ExpressionAttributeNames: { '#updatedAt': 'updatedAt', '#tierId': 'tierId' },
            ExpressionAttributeValues: {
                ':qty': Math.abs(qty),
                ':zero': 0,
                ':updatedAt': new Date().toISOString()
            },
            ConditionExpression: 'attribute_exists(#tierId)'
        })
            .promise();
        console.info('tier.adjust', {
            ownerId,
            bookId,
            tierId,
            delta: -Math.abs(qty),
            source: 'event'
        });
        return true;
    }
    catch (err) {
        if (err?.code === 'ConditionalCheckFailedException') {
            return false;
        }
        throw err;
    }
}
async function decrementLegacyBook(ownerId, bookId, qty) {
    await dynamo_1.default
        .update({
        TableName: dynamo_1.TABLE_NAME,
        Key: {
            PK: (0, keys_1.bookPartition)(ownerId),
            SK: (0, keys_1.bookSortKey)(bookId)
        },
        UpdateExpression: 'SET copiesOnHand = if_not_exists(copiesOnHand, :zero) - :qty, #updatedAt = :updatedAt',
        ExpressionAttributeValues: {
            ':qty': Math.abs(qty),
            ':zero': 0,
            ':updatedAt': new Date().toISOString()
        },
        ExpressionAttributeNames: { '#updatedAt': 'updatedAt' }
    })
        .promise();
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
    if (!Number.isFinite(price)) {
        return null;
    }
    const res = await dynamo_1.default
        .query({
        TableName: dynamo_1.TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: {
            ':pk': (0, keys_1.bookPartition)(ownerId),
            ':prefix': (0, keys_1.tierPrefix)(bookId),
            ':price': price
        },
        ExpressionAttributeNames: { '#price': 'price' },
        FilterExpression: '#price = :price',
        Limit: 1
    })
        .promise();
    if (!res.Items?.length) {
        return null;
    }
    return res.Items[0];
}
const handler = async (event) => {
    try {
        const ownerId = (0, auth_1.requireUserId)(event);
        const method = event.requestContext.http.method.toUpperCase();
        const path = event.rawPath || '';
        const eventId = event.pathParameters?.['id'];
        if (method === 'GET' && path === '/events') {
            return await listEvents(ownerId);
        }
        if (method === 'GET' && eventId) {
            const record = await getEvent(ownerId, eventId);
            if (!record) {
                return (0, http_1.badRequest)('Event not found');
            }
            return (0, http_1.ok)(toClientEvent(record));
        }
        if (method === 'POST' && path === '/events') {
            return await createEvent(ownerId, event);
        }
        if (method === 'POST' && eventId && path.endsWith('/apply')) {
            return await applyEvent(ownerId, eventId);
        }
        return (0, http_1.badRequest)('Unsupported route');
    }
    catch (err) {
        console.error('events handler error', err);
        const message = err?.message || 'Internal error';
        if (message === 'Unauthorized') {
            return (0, http_1.unauthorized)();
        }
        return (0, http_1.serverError)(message);
    }
};
exports.handler = handler;
