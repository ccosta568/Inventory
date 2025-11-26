export const environment = {
  production: false,
  /**
   * Replace with the dev httpApiUrl printed by
   * `serverless info --stage dev --region us-east-1`
   * e.g. https://xxxxx.execute-api.us-east-1.amazonaws.com/dev
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
