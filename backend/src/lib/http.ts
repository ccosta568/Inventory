import { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

const defaultHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*'
};

export function ok(body: unknown = {}): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode: 200,
    headers: defaultHeaders,
    body: JSON.stringify(body)
  };
}

export function created(body: unknown = {}): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode: 201,
    headers: defaultHeaders,
    body: JSON.stringify(body)
  };
}

export function noContent(): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode: 204,
    headers: defaultHeaders,
    body: ''
  };
}

export function badRequest(message: string): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode: 400,
    headers: defaultHeaders,
    body: JSON.stringify({ message })
  };
}

export function unauthorized(message = 'Unauthorized'): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode: 401,
    headers: defaultHeaders,
    body: JSON.stringify({ message })
  };
}

export function serverError(message: string): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode: 500,
    headers: defaultHeaders,
    body: JSON.stringify({ message })
  };
}
