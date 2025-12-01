export const environment = {
  production: true,
  apiBaseUrl: 'https://ac3xod6f55.execute-api.us-east-1.amazonaws.com',
  cognito: {
    userPoolId: 'us-east-1_3XVqDIc0T',
    clientId: '78b8ilrnvr1m8ft2ks2l06eibe',
    domain: 'https://author-inventory-dev.auth.us-east-1.amazonaws.com',
 redirectUrl: 'https://booktok.click',
    logoutUrl: 'https://booktok.click',
    scope: 'openid profile email'
  },
  oidc: {
    authority: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_3XVqDIc0T',
    clientId: '78b8ilrnvr1m8ft2ks2l06eibe',
 redirectUrl: 'https://booktok.click',
    logoutUrl: 'https://booktok.click',
    scope: 'openid profile email',
    responseType: 'code'
  }
};
