"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.booksHandler = void 0;
const aws_sdk_1 = require("aws-sdk");
const uuid_1 = require("uuid");
const TABLE_NAME = process.env['TABLE_NAME'] ?? '';
const API_SHARED_SECRET = process.env['API_SHARED_SECRET'] ?? '';
const ddb = new aws_sdk_1.DynamoDB.DocumentClient();
const booksHandler = async (event) => {
    try {
        // Simple shared-secret header check (if configured)
        if (API_SHARED_SECRET) {
            const headers = (event.headers || {});
            const provided = (headers['x-api-key'] || headers['X-Api-Key'] || headers['authorization'] || '').trim();
            if (!provided || provided !== API_SHARED_SECRET) {
                return { statusCode: 401, body: JSON.stringify({ message: 'Unauthorized' }) };
            }
        }
        const method = event.requestContext.http.method.toUpperCase();
        if (method === 'GET') {
            // Scan all books (small table expected)
            const res = await ddb.scan({ TableName: TABLE_NAME }).promise();
            return {
                statusCode: 200,
                body: JSON.stringify(res.Items || []),
            };
        }
        if (method === 'POST' && event.rawPath === '/books') {
            const payload = event.body ? JSON.parse(event.body) : {};
            const now = new Date().toISOString();
            const item = {
                id: (0, uuid_1.v4)(),
                title: payload.title || 'Untitled',
                author: payload.author,
                isbn: payload.isbn,
                format: payload.format,
                price: payload.price,
                copiesOnHand: payload.copiesOnHand ?? 0,
                notes: payload.notes,
                createdAt: now,
                updatedAt: now,
            };
            await ddb.put({ TableName: TABLE_NAME, Item: item }).promise();
            return { statusCode: 201, body: JSON.stringify(item) };
        }
        // PUT to update book
        if (method === 'PUT' && event.pathParameters && event.pathParameters['id']) {
            const id = event.pathParameters['id'];
            const payload = event.body ? JSON.parse(event.body) : {};
            const now = new Date().toISOString();
            const updateExpressions = [];
            const expressionAttributeNames = {};
            const expressionAttributeValues = {};
            const updatable = ['title', 'author', 'isbn', 'format', 'price', 'copiesOnHand', 'notes'];
            updatable.forEach((key) => {
                if (payload[key] !== undefined) {
                    const nameKey = `#${key}`;
                    const valKey = `:${key}`;
                    updateExpressions.push(`${nameKey} = ${valKey}`);
                    expressionAttributeNames[nameKey] = key;
                    expressionAttributeValues[valKey] = payload[key];
                }
            });
            // always set updatedAt
            updateExpressions.push('#updatedAt = :updatedAt');
            expressionAttributeNames['#updatedAt'] = 'updatedAt';
            expressionAttributeValues[':updatedAt'] = now;
            const params = {
                TableName: TABLE_NAME,
                Key: { id },
                UpdateExpression: 'SET ' + updateExpressions.join(', '),
                ExpressionAttributeNames: expressionAttributeNames,
                ExpressionAttributeValues: expressionAttributeValues,
                ReturnValues: 'ALL_NEW',
            };
            const res = await ddb.update(params).promise();
            return { statusCode: 200, body: JSON.stringify(res.Attributes) };
        }
        // POST adjust stock
        if (method === 'POST' && event.rawPath && event.rawPath.match(/^\/books\/[^/]+\/adjust-stock$/)) {
            const id = event.pathParameters ? event.pathParameters['id'] : undefined;
            if (!id)
                return { statusCode: 400, body: 'Missing id' };
            const payload = event.body ? JSON.parse(event.body) : {};
            const delta = Number(payload.delta) || 0;
            const params = {
                TableName: TABLE_NAME,
                Key: { id },
                UpdateExpression: 'SET copiesOnHand = if_not_exists(copiesOnHand, :zero) + :d, #updatedAt = :u',
                ExpressionAttributeNames: { '#updatedAt': 'updatedAt' },
                ExpressionAttributeValues: { ':d': delta, ':u': new Date().toISOString(), ':zero': 0 },
                ReturnValues: 'ALL_NEW',
            };
            const res = await ddb.update(params).promise();
            return { statusCode: 200, body: JSON.stringify(res.Attributes) };
        }
        return { statusCode: 400, body: 'Unsupported route' };
    }
    catch (err) {
        console.error('booksHandler error', err);
        return { statusCode: 500, body: JSON.stringify({ message: err.message || 'Internal error' }) };
    }
};
exports.booksHandler = booksHandler;
