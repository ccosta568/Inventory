import { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import dynamo, { TABLE_NAME } from '../lib/dynamo';
import { requireUserId } from '../lib/auth';
import { badRequest, created, ok, serverError, unauthorized } from '../lib/http';
import { EventInput, EventLineInput, EventRecord } from '../lib/models';
import type { DocumentClient } from 'aws-sdk/clients/dynamodb';
import {
  EVENT_META_GSI_SK,
  eventLinePartition,
  eventLineSortKey,
  eventPartition,
  eventSortKey,
  gsiBookEvent,
  gsiEventMeta,
  bookPartition,
  bookSortKey
} from '../lib/keys';

function parseBody<T>(event: APIGatewayProxyEventV2): T | null {
  if (!event.body) return null;
  try {
    return JSON.parse(event.body) as T;
  } catch (err) {
    console.error('Failed to parse body', err);
    return null;
  }
}

function toClientEvent(item: EventRecord) {
  if (!item) return null;
  return {
    id: item.eventId,
    eventName: item.eventName,
    date: item.date,
    lines: item.lines || [],
    notes: item.notes,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    appliedAt: (item as any).appliedAt
  };
}

async function listEvents(ownerId: string) {
  const res = await dynamo
    .query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': eventPartition(ownerId) },
      ScanIndexForward: false
    })
    .promise();

  const events = (res.Items || []).map((item) => toClientEvent(item as EventRecord));
  return ok(events);
}

async function getEvent(ownerId: string, eventId: string) {
  const res = await dynamo
    .query({
      TableName: TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND GSI1SK = :sk',
      ExpressionAttributeValues: {
        ':pk': gsiEventMeta(ownerId, eventId),
        ':sk': EVENT_META_GSI_SK
      },
      Limit: 1
    })
    .promise();

  if (!res.Items?.length) {
    return null;
  }
  return res.Items[0] as EventRecord;
}

function validateEventInput(payload: EventInput | null): payload is EventInput {
  if (!payload) return false;
  if (!payload.eventName || !payload.date) return false;
  if (!Array.isArray(payload.lines)) return false;
  return payload.lines.every((line) => line.bookId && Number.isFinite(line.qtySold));
}

async function createEvent(ownerId: string, event: APIGatewayProxyEventV2) {
  const payload = parseBody<EventInput>(event);
  if (!validateEventInput(payload)) {
    return badRequest('Invalid event payload');
  }

  const now = new Date().toISOString();
  const eventId = payload.id || uuidv4();
  const meta: EventRecord = {
    PK: eventPartition(ownerId),
    SK: eventSortKey(payload.date, eventId),
    entityType: 'EVENT',
    ownerId,
    eventId,
    eventName: payload.eventName,
    date: payload.date,
    lines: payload.lines,
    notes: payload.notes,
    createdAt: now,
    updatedAt: now
  };

  const items: DocumentClient.WriteRequests = [
    {
      PutRequest: {
        Item: {
          ...meta,
          GSI1PK: gsiEventMeta(ownerId, eventId),
          GSI1SK: EVENT_META_GSI_SK
        }
      }
    }
  ];

  payload.lines.forEach((line, index) => {
    items.push({
      PutRequest: {
        Item: {
          PK: eventLinePartition(ownerId, eventId),
          SK: eventLineSortKey(index, line.bookId),
          entityType: 'EVENT_LINE',
          ownerId,
          eventId,
          bookId: line.bookId,
          qtySold: line.qtySold,
          date: payload.date,
          gsi1pk: gsiBookEvent(ownerId, line.bookId),
          gsi1sk: eventSortKey(payload.date, eventId)
        }
      }
    });
  });

  while (items.length) {
    const batch = items.splice(0, 25) as DocumentClient.WriteRequests;
    let requestItems: DocumentClient.BatchWriteItemRequestMap = { [TABLE_NAME]: batch };
    do {
      const res = await dynamo
        .batchWrite({
          RequestItems: requestItems
        })
        .promise();
      const unprocessed = res.UnprocessedItems?.[TABLE_NAME];
      if (unprocessed && unprocessed.length) {
        requestItems = { [TABLE_NAME]: unprocessed };
      } else {
        requestItems = { [TABLE_NAME]: [] };
      }
    } while (requestItems[TABLE_NAME].length);
  }

  return created(toClientEvent(meta));
}

async function applyEvent(ownerId: string, eventId: string) {
  const eventRecord = await getEvent(ownerId, eventId);
  if (!eventRecord) {
    return badRequest('Event not found');
  }

  const lines: EventLineInput[] = (eventRecord.lines || []) as EventLineInput[];
  for (const line of lines) {
    await dynamo
      .update({
        TableName: TABLE_NAME,
        Key: {
          PK: bookPartition(ownerId),
          SK: bookSortKey(line.bookId)
        },
        UpdateExpression:
          'SET copiesOnHand = if_not_exists(copiesOnHand, :zero) - :qty, #updatedAt = :updatedAt',
        ExpressionAttributeValues: {
          ':qty': Math.abs(line.qtySold),
          ':zero': 0,
          ':updatedAt': new Date().toISOString()
        },
        ExpressionAttributeNames: { '#updatedAt': 'updatedAt' }
      })
      .promise();
  }

  await dynamo
    .update({
      TableName: TABLE_NAME,
      Key: {
        PK: eventPartition(ownerId),
        SK: eventRecord.SK
      },
      UpdateExpression: 'SET appliedAt = :appliedAt',
      ExpressionAttributeValues: {
        ':appliedAt': new Date().toISOString()
      }
    })
    .promise();

  return ok({ message: 'Event applied to inventory' });
}

export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyStructuredResultV2> => {
  try {
    const ownerId = requireUserId(event);
    const method = event.requestContext.http.method.toUpperCase();
    const path = event.rawPath || '';
    const eventId = event.pathParameters?.['id'];

    if (method === 'GET' && path === '/events') {
      return await listEvents(ownerId);
    }

    if (method === 'GET' && eventId) {
      const record = await getEvent(ownerId, eventId);
      if (!record) {
        return badRequest('Event not found');
      }
      return ok(toClientEvent(record));
    }

    if (method === 'POST' && path === '/events') {
      return await createEvent(ownerId, event);
    }

    if (method === 'POST' && eventId && path.endsWith('/apply')) {
      return await applyEvent(ownerId, eventId);
    }

    return badRequest('Unsupported route');
  } catch (err: any) {
    console.error('events handler error', err);
    const message = err?.message || 'Internal error';
    if (message === 'Unauthorized') {
      return unauthorized();
    }
    return serverError(message);
  }
};
