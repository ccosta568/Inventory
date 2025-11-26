import { LogLevel, PassedInitialConfig } from 'angular-auth-oidc-client';

export const COGNITO_CONFIG_ID = 'cognito';

export const authConfig: PassedInitialConfig = {
  config: {
    configId: COGNITO_CONFIG_ID,
    authority: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_oC5Z0W1lN',
    redirectUrl: 'http://localhost:4200',
    postLogoutRedirectUri: 'http://localhost:4200',
    clientId: '5l2voqhrg7q3fjbocjlej142g0',
    scope: 'openid email phone',
    responseType: 'code',
    silentRenew: false,
    useRefreshToken: false,
    secureRoutes: [
      'https://012c4578g2.execute-api.us-east-1.amazonaws.com/prod',
    ],
    unauthorizedRoute: '/unauthorized',
    logLevel: LogLevel.Debug,
  },
};
