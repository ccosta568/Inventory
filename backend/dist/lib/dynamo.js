"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TABLE_NAME = void 0;
const aws_sdk_1 = require("aws-sdk");
const client = new aws_sdk_1.DynamoDB.DocumentClient({
    convertEmptyValues: true
});
exports.TABLE_NAME = process.env['TABLE_NAME'] ?? '';
exports.default = client;
