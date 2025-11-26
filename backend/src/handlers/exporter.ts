import { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import S3 from 'aws-sdk/clients/s3';
import dynamo, { TABLE_NAME } from '../lib/dynamo';

const EXPORT_BUCKET = process.env['EXPORT_BUCKET_NAME'] ?? '';
const s3 = new S3();

export const handler = async (): Promise<APIGatewayProxyStructuredResultV2> => {
  if (!EXPORT_BUCKET) {
    console.warn('EXPORT_BUCKET_NAME not configured, skipping backup');
    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Skipped export (bucket not configured)' })
    };
  }

  const allItems: any[] = [];
  let lastEvaluatedKey: Record<string, any> | undefined;

  do {
    const res = await dynamo
      .scan({
        TableName: TABLE_NAME,
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
