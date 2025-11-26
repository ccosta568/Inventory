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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const s3_1 = __importDefault(require("aws-sdk/clients/s3"));
const dynamo_1 = __importStar(require("../lib/dynamo"));
const EXPORT_BUCKET = process.env['EXPORT_BUCKET_NAME'] ?? '';
const s3 = new s3_1.default();
const handler = async () => {
    if (!EXPORT_BUCKET) {
        console.warn('EXPORT_BUCKET_NAME not configured, skipping backup');
        return {
            statusCode: 200,
            body: JSON.stringify({ message: 'Skipped export (bucket not configured)' })
        };
    }
    const allItems = [];
    let lastEvaluatedKey;
    do {
        const res = await dynamo_1.default
            .scan({
            TableName: dynamo_1.TABLE_NAME,
            ExclusiveStartKey: lastEvaluatedKey
        })
            .promise();
        if (res.Items?.length) {
            allItems.push(...res.Items);
        }
        lastEvaluatedKey = res.LastEvaluatedKey;
    } while (lastEvaluatedKey);
    const key = `backup-${new Date().toISOString()}.json`;
    await s3
        .putObject({
        Bucket: EXPORT_BUCKET,
        Key: key,
        Body: JSON.stringify({ exportedAt: new Date().toISOString(), count: allItems.length, items: allItems }),
        ContentType: 'application/json'
    })
        .promise();
    return {
        statusCode: 200,
        body: JSON.stringify({ message: `Exported ${allItems.length} items to s3://${EXPORT_BUCKET}/${key}` })
    };
};
exports.handler = handler;
