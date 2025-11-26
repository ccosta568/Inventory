import { APIGatewayProxyEventV2 } from 'aws-lambda';

/**
 * TEMP DEV AUTH:
 *  - Accepts an optional `x-dev-user` header to scope data locally.
 *  - Falls back to `dev-user` when no header/JWT is present.
 *  - TODO: Replace with proper Cognito JWT validation once authorizer is re-enabled.
 */
export function requireUserId(event: APIGatewayProxyEventV2): string {
  const headers = event?.headers ?? {};
  const headerKey = Object.keys(headers).find((key) => key.toLowerCase() === 'x-dev-user');
  const headerUser = headerKey ? headers[headerKey] : undefined;
  if (headerUser) {
    return headerUser;
  }

  const ctx: any = event?.requestContext;
  const jwt = ctx?.authorizer?.jwt;

  if (!jwt?.claims) {
    return 'dev-user';
  }

  console.log('Auth context:', JSON.stringify(ctx?.authorizer ?? {}, null, 2));

  const rawEmail =
    (jwt.claims.email as string | undefined) ??
    (jwt.claims['cognito:username'] as string | undefined) ??
    (jwt.claims.username as string | undefined);
  const email = rawEmail?.toLowerCase();
  console.log('JWT email claim:', email ?? 'n/a');

  const sub = jwt.claims.sub as string | undefined;
  return sub ?? email ?? 'unknown-user';
}
