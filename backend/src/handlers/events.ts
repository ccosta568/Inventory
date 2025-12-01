import { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { randomUUID } from 'crypto';
import dynamo, { TABLE_NAME } from '../lib/dynamo';
import { requireUserId } from '../lib/auth';
import { badRequest, created, ok, serverError, unauthorized } from '../lib/http';
import { EventInput, EventLineInput, EventRecord, PriceTierRecord } from '../lib/models';
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
  bookSortKey,
  tierPrefix,
  tierSortKey
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

type NormalizedEventLine = EventLineInput & {
  price: number;
  revenue: number;
  qtySold: number;
};

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
  return payload.lines.every((line) => {
    if (!line.bookId || !Number.isFinite(line.qtySold)) {
      return false;
    }
    if (line.tierId) {
      return true;
    }
    return Number.isFinite(line.price);
  });
}

async function createEvent(ownerId: string, event: APIGatewayProxyEventV2) {
  const payload = parseBody<EventInput>(event);
  if (!validateEventInput(payload)) {
    return badRequest('Invalid event payload');
  }

  let normalizedLines: NormalizedEventLine[];
  try {
    normalizedLines = await normalizeEventLines(ownerId, payload.lines);
  } catch (err: any) {
    console.error('Failed to normalize event lines', err);
    return badRequest(err?.message || 'Invalid event lines');
  }

  const now = new Date().toISOString();
  const eventId = payload.id || randomUUID();
  const meta: EventRecord = {
    PK: eventPartition(ownerId),
    SK: eventSortKey(payload.date, eventId),
    entityType: 'EVENT',
    ownerId,
    eventId,
    eventName: payload.eventName,
    date: payload.date,
    lines: normalizedLines,
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

  normalizedLines.forEach((line, index) => {
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
          tierId: line.tierId,
          price: line.price,
          revenue: line.revenue,
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

  console.info('event.logged', { ownerId, eventId, lineCount: normalizedLines.length });
  return created(toClientEvent(meta));
}

async function applyEvent(ownerId: string, eventId: string) {
  const eventRecord = await getEvent(ownerId, eventId);
  if (!eventRecord) {
    return badRequest('Event not found');
  }

  const lines: EventLineInput[] = (eventRecord.lines || []) as EventLineInput[];
  for (const line of lines) {
    await applyLineToInventory(ownerId, line);
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

  console.info('event.applied', { ownerId, eventId, lineCount: lines.length });
  return ok({ message: 'Event applied to inventory' });
}

async function normalizeEventLines(ownerId: string, lines: EventLineInput[]): Promise<NormalizedEventLine[]> {
  const normalized: NormalizedEventLine[] = [];

  for (const line of lines) {
    if (!line.bookId) {
      continue;
    }

    const qty = Math.abs(Number(line.qtySold ?? 0));
    if (!Number.isFinite(qty) || qty <= 0) {
      continue;
    }

    let tierId = line.tierId;
    let price = typeof line.price === 'number' && Number.isFinite(line.price) ? Number(line.price) : undefined;

    if (!tierId && price === undefined) {
      throw new Error('Each sale line must include a tierId or price.');
    }

    if ((price === undefined || Number.isNaN(price)) && tierId) {
      const tier = await getTierRecord(ownerId, line.bookId, tierId);
      if (!tier) {
        throw new Error(`Tier ${tierId} not found for book ${line.bookId}.`);
      }
      price = Number(tier.price ?? 0);
    }

    if (price === undefined || Number.isNaN(price)) {
      throw new Error(`Price missing for sale line on book ${line.bookId}.`);
    }

    normalized.push({
      bookId: line.bookId,
      tierId,
      price,
      qtySold: qty,
      revenue: qty * price
    });
  }

  return normalized;
}

async function applyLineToInventory(ownerId: string, line: EventLineInput): Promise<void> {
  if (!line.bookId || !Number.isFinite(line.qtySold)) {
    return;
  }

  const qty = Math.abs(line.qtySold);
  if (!qty) {
    return;
  }

  if (line.tierId) {
    const applied = await decrementTierCopies(ownerId, line.bookId, line.tierId, qty);
    if (applied) {
      return;
    }
  }

  if (Number.isFinite(line.price)) {
    const tier = await findTierByPrice(ownerId, line.bookId, Number(line.price));
    if (tier && (await decrementTierCopies(ownerId, line.bookId, tier.tierId, qty))) {
      return;
    }
  }

  await decrementLegacyBook(ownerId, line.bookId, qty);
}

async function decrementTierCopies(ownerId: string, bookId: string, tierId: string, qty: number): Promise<boolean> {
  try {
    await dynamo
      .update({
        TableName: TABLE_NAME,
        Key: {
          PK: bookPartition(ownerId),
          SK: tierSortKey(bookId, tierId)
        },
        UpdateExpression:
          'SET copiesOnHand = if_not_exists(copiesOnHand, :zero) - :qty, #updatedAt = :updatedAt',
        ExpressionAttributeNames: { '#updatedAt': 'updatedAt', '#tierId': 'tierId' },
        ExpressionAttributeValues: {
          ':qty': Math.abs(qty),
          ':zero': 0,
          ':updatedAt': new Date().toISOString()
        },
        ConditionExpression: 'attribute_exists(#tierId)'
      })
      .promise();

    console.info('tier.adjust', {
      ownerId,
      bookId,
      tierId,
      delta: -Math.abs(qty),
      source: 'event'
    });
    return true;
  } catch (err: any) {
    if (err?.code === 'ConditionalCheckFailedException') {
      return false;
    }
    throw err;
  }
}

async function decrementLegacyBook(ownerId: string, bookId: string, qty: number): Promise<void> {
  await dynamo
    .update({
      TableName: TABLE_NAME,
      Key: {
        PK: bookPartition(ownerId),
        SK: bookSortKey(bookId)
      },
      UpdateExpression:
        'SET copiesOnHand = if_not_exists(copiesOnHand, :zero) - :qty, #updatedAt = :updatedAt',
      ExpressionAttributeValues: {
        ':qty': Math.abs(qty),
        ':zero': 0,
        ':updatedAt': new Date().toISOString()
      },
      ExpressionAttributeNames: { '#updatedAt': 'updatedAt' }
    })
    .promise();
}

async function getTierRecord(ownerId: string, bookId: string, tierId: string): Promise<PriceTierRecord | null> {
  const res = await dynamo
    .get({
      TableName: TABLE_NAME,
      Key: {
        PK: bookPartition(ownerId),
        SK: tierSortKey(bookId, tierId)
      }
    })
    .promise();

  if (!res.Item) {
    return null;
  }
  return res.Item as PriceTierRecord;
}

async function findTierByPrice(ownerId: string, bookId: string, price: number): Promise<PriceTierRecord | null> {
  if (!Number.isFinite(price)) {
    return null;
  }

  const res = await dynamo
    .query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': bookPartition(ownerId),
        ':prefix': tierPrefix(bookId),
        ':price': price
      },
      ExpressionAttributeNames: { '#price': 'price' },
      FilterExpression: '#price = :price',
      Limit: 1
    })
    .promise();

  if (!res.Items?.length) {
    return null;
  }
  return res.Items[0] as PriceTierRecord;
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
