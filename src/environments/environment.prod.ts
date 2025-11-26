export const environment = {
  production: true,
  /**
   * Replace with the prod httpApiUrl printed by
   * `serverless info --stage prod --region us-east-1`
   * e.g. https://xxxxx.execute-api.us-east-1.amazonaws.com/prod
   */
  apiBaseUrl: 'https://sfm95bry33.execute-api.us-east-1.amazonaws.com',
  apiSharedSecret: '',
  cognito: {
    domain: '',
    clientId: '',
    clientSecret: '',
    region: 'us-east-1',
    userPoolId: ''
  }
};
