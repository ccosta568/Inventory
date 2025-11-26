import { DynamoDB } from 'aws-sdk';

const client = new DynamoDB.DocumentClient({
  convertEmptyValues: true
});

export const TABLE_NAME = process.env['TABLE_NAME'] ?? '';

export default client;
