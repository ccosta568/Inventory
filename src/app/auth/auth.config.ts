import { LogLevel, PassedInitialConfig } from 'angular-auth-oidc-client';

import { environment } from '../../environments/environment';

export const COGNITO_CONFIG_ID = 'cognito';

function buildAuthority(): string {
  if (environment.oidc?.authority) {
    return environment.oidc.authority;
  }
  const poolId = environment.cognito?.userPoolId || 'us-east-1_example';
  // Fallback to the default us-east-1 region when no explicit authority is provided.
  return `https://cognito-idp.us-east-1.amazonaws.com/${poolId}`;
}

export function buildAuthConfig(): PassedInitialConfig {
  const apiBase = (environment.apiBaseUrl ?? '').replace(/\/$/, '');
  const cognito = environment.cognito ?? {};
  const oidc = environment.oidc ?? {};
  const scope = oidc.scope || cognito.scope || 'openid profile email';
  const redirectUrl = oidc.redirectUrl || cognito.redirectUrl || 'http://localhost:4200';
  const logoutUrl =
    oidc.postLogoutRedirectUri || cognito.logoutUrl || cognito.redirectUrl || 'http://localhost:4200';
  const clientId = oidc.clientId || cognito.clientId || 'replace-with-cognito-client-id';

  return {
    config: {
      configId: COGNITO_CONFIG_ID,
      authority: buildAuthority(),
      redirectUrl,
      postLogoutRedirectUri: logoutUrl,
      clientId,
      scope,
      responseType: oidc.responseType || 'code',
      silentRenew: true,
      useRefreshToken: true,
      secureRoutes: apiBase ? [apiBase] : [],
      unauthorizedRoute: '/unauthorized',
      logLevel: environment.production ? LogLevel.Error : LogLevel.Debug
    }
  };
}
