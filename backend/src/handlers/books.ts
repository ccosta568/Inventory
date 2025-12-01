import { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { DocumentClient } from 'aws-sdk/clients/dynamodb';
import { randomUUID } from 'crypto';
import dynamo, { TABLE_NAME } from '../lib/dynamo';
import { requireUserId } from '../lib/auth';
import { badRequest, created, noContent, ok, serverError, unauthorized } from '../lib/http';
import { BookInput, BookRecord, PriceTierRecord } from '../lib/models';
import { bookPartition, bookSortKey, tierPrefix, tierSortKey } from '../lib/keys';

type BookPayload = BookInput & {
  copies?: number;
  delta?: number;
  tierId?: string;
};

function normalizeValue(value?: string | null): string {
  return (value ?? '').trim().toLowerCase();
}

function normalizeFormat(value?: string | null): string {
  return value ? value.trim().toLowerCase() : 'paperback';
}

function buildIdentityKey(title?: string | null, author?: string | null, format?: string | null): string {
  return `${normalizeValue(title)}|${normalizeValue(author)}|${normalizeFormat(format)}`;
}

function parseBody<T>(event: APIGatewayProxyEventV2): T | null {
  if (!event.body) return null;
  try {
    return JSON.parse(event.body) as T;
  } catch (err) {
    console.error('Failed to parse body', err);
    return null;
  }
}

interface ClientPriceTier {
  bookId: string;
  tierId: string;
  price: number;
  copiesOnHand: number;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface ClientBook {
  id: string;
  title: string;
  author?: string;
  format?: string;
  notes?: string;
  priceTiers: ClientPriceTier[];
  totalOnHand: number;
  createdAt?: string;
  updatedAt?: string;
}

function toClientTier(item?: PriceTierRecord | null): ClientPriceTier | null {
  if (!item?.tierId) return null;
  return {
    bookId: item.bookId,
    tierId: item.tierId,
    price: Number(item.price ?? 0),
    copiesOnHand: Number(item.copiesOnHand ?? 0),
    notes: item.notes ?? '',
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  };
}

function legacyTierFromBook(item?: BookRecord | null): ClientPriceTier | null {
  if (!item) return null;
  const copies = Number(item.copiesOnHand ?? 0);
  const price = Number(item.price ?? 0);
  if (!copies && !price && !item.notes) {
    return null;
  }
  return {
    bookId: item.bookId,
    tierId: item.bookId,
    price,
    copiesOnHand: copies,
    notes: item.notes ?? '',
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  };
}

function toClientBook(item?: BookRecord | null, tiers: PriceTierRecord[] = []): ClientBook | null {
  if (!item) return null;
  const mapped = tiers
    .map((tier) => toClientTier(tier))
    .filter((tier): tier is ClientPriceTier => !!tier);

  if (!mapped.length) {
    const fallback = legacyTierFromBook(item);
    if (fallback) {
      mapped.push(fallback);
    }
  }

  const totalOnHand = mapped.reduce((sum, tier) => sum + tier.copiesOnHand, 0);

  return {
    id: item.bookId,
    title: item.title,
    author: item.author,
    format: item.format ?? 'paperback',
    notes: item.notes ?? '',
    priceTiers: mapped,
    totalOnHand,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  };
}

async function loadBook(ownerId: string, bookId: string): Promise<ClientBook | null> {
  const res = await dynamo
    .query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': bookPartition(ownerId),
        ':sk': bookSortKey(bookId)
      }
    })
    .promise();

  if (!res.Items?.length) {
    return null;
  }

  let bookRecord: BookRecord | undefined;
  const tiers: PriceTierRecord[] = [];
  for (const item of res.Items) {
    if ((item as BookRecord).entityType === 'BOOK') {
      bookRecord = item as BookRecord;
    } else if ((item as PriceTierRecord).entityType === 'BOOK_TIER') {
      tiers.push(item as PriceTierRecord);
    }
  }

  return toClientBook(bookRecord, tiers);
}

function bookIdentityKeyFromRecord(item: BookRecord): string {
  if (item.normalizedTitle || item.normalizedAuthor || item.normalizedFormat) {
    return buildIdentityKey(item.normalizedTitle, item.normalizedAuthor, item.normalizedFormat);
  }
  return buildIdentityKey(item.title, item.author, item.format);
}

async function findBookByIdentity(ownerId: string, identityKey: string): Promise<BookRecord | null> {
  const res = await dynamo
    .query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': bookPartition(ownerId),
        ':sk': 'BOOK#'
      }
    })
    .promise();

  for (const item of res.Items || []) {
    const record = item as BookRecord;
    if (bookIdentityKeyFromRecord(record) === identityKey) {
      return record;
    }
  }
  return null;
}

async function mergeIntoExistingBook(
  ownerId: string,
  existing: BookRecord,
  tierPrice: number,
  copies: number,
  tierNotes: string
): Promise<ClientBook | null> {
  const tier = await findTierByPrice(ownerId, existing.bookId, tierPrice);
  const now = new Date().toISOString();
  if (tier) {
    await dynamo
      .update({
        TableName: TABLE_NAME,
        Key: {
          PK: bookPartition(ownerId),
          SK: tierSortKey(existing.bookId, tier.tierId)
        },
        UpdateExpression:
          'SET copiesOnHand = if_not_exists(copiesOnHand, :zero) + :copies, #updatedAt = :updatedAt',
        ExpressionAttributeNames: { '#updatedAt': 'updatedAt' },
        ExpressionAttributeValues: {
          ':copies': copies,
          ':zero': 0,
          ':updatedAt': now
        }
      })
      .promise();
  } else {
    const tierId = randomUUID();
    const newTier: PriceTierRecord = {
      PK: bookPartition(ownerId),
      SK: tierSortKey(existing.bookId, tierId),
      entityType: 'BOOK_TIER',
      ownerId,
      bookId: existing.bookId,
      tierId,
      price: tierPrice,
      copiesOnHand: copies,
      notes: tierNotes,
      createdAt: now,
      updatedAt: now
    };
    await dynamo
      .put({
        TableName: TABLE_NAME,
        Item: newTier
      })
      .promise();
  }

  await dynamo
    .update({
      TableName: TABLE_NAME,
      Key: {
        PK: bookPartition(ownerId),
        SK: bookSortKey(existing.bookId)
      },
      UpdateExpression:
        'SET copiesOnHand = if_not_exists(copiesOnHand, :zero) + :copies, #updatedAt = :updatedAt',
      ExpressionAttributeNames: { '#updatedAt': 'updatedAt' },
      ExpressionAttributeValues: {
        ':copies': copies,
        ':zero': 0,
        ':updatedAt': now
      }
    })
    .promise();

  console.info('book.merge', {
    ownerId,
    bookId: existing.bookId,
    price: tierPrice,
    copies
  });

  return loadBook(ownerId, existing.bookId);
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
  const res = await dynamo
    .query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeNames: { '#price': 'price' },
      ExpressionAttributeValues: {
        ':pk': bookPartition(ownerId),
        ':prefix': tierPrefix(bookId),
        ':price': price
      },
      FilterExpression: '#price = :price',
      Limit: 1
    })
    .promise();

  if (!res.Items?.length) {
    return null;
  }
  return res.Items[0] as PriceTierRecord;
}

async function listBooks(ownerId: string) {
  const res = await dynamo
    .query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': bookPartition(ownerId) }
    })
    .promise();

  const grouped = new Map<string, { book?: BookRecord; tiers: PriceTierRecord[] }>();
  for (const item of res.Items || []) {
    const entityType = (item as any).entityType;
    if (entityType === 'BOOK') {
      const entry = grouped.get((item as BookRecord).bookId) || { tiers: [] };
      entry.book = item as BookRecord;
      grouped.set(entry.book.bookId, entry);
    } else if (entityType === 'BOOK_TIER') {
      const tier = item as PriceTierRecord;
      if (!tier.bookId) continue;
      const entry = grouped.get(tier.bookId) || { tiers: [] };
      entry.tiers.push(tier);
      grouped.set(tier.bookId, entry);
    }
  }

  const books = Array.from(grouped.values())
    .map(({ book, tiers }) => toClientBook(book, tiers))
    .filter((book): book is NonNullable<ReturnType<typeof toClientBook>> => !!book);
  return ok(books);
}

async function createBook(ownerId: string, event: APIGatewayProxyEventV2) {
  const payload = parseBody<BookPayload>(event);
  if (!payload || !payload.title?.trim()) {
    return badRequest('Title is required');
  }

  const now = new Date().toISOString();
  const bookId = randomUUID();
  const copies = Number(payload.copiesOnHand ?? payload.copies ?? 0) || 0;
  const tierPrice = Number(payload.price ?? 0) || 0;
  const tierNotes = payload.tierNotes ?? payload.notes ?? '';
  const identityKey = buildIdentityKey(payload.title, payload.author, payload.format);

  const existingBook = await findBookByIdentity(ownerId, identityKey);
  if (existingBook) {
    const merged = await mergeIntoExistingBook(ownerId, existingBook, tierPrice, copies, tierNotes);
    return ok(merged);
  }

  const item: BookRecord = {
    PK: bookPartition(ownerId),
    SK: bookSortKey(bookId),
    entityType: 'BOOK',
    ownerId,
    bookId,
    title: payload.title.trim(),
    author: payload.author?.trim(),
    format: payload.format ?? 'paperback',
    normalizedTitle: normalizeValue(payload.title),
    normalizedAuthor: normalizeValue(payload.author),
    normalizedFormat: normalizeFormat(payload.format),
    price: tierPrice,
    copiesOnHand: copies,
    notes: payload.notes ?? '',
    createdAt: now,
    updatedAt: now
  };

  const tierId = randomUUID();
  const tier = {
    PK: bookPartition(ownerId),
    SK: tierSortKey(bookId, tierId),
    entityType: 'BOOK_TIER',
    ownerId,
    bookId,
    tierId,
    price: tierPrice,
    copiesOnHand: copies,
    notes: tierNotes,
    createdAt: now,
    updatedAt: now
  } as PriceTierRecord;

  await dynamo
    .put({
      TableName: TABLE_NAME,
      Item: item
    })
    .promise();

  try {
    await dynamo
      .put({
        TableName: TABLE_NAME,
        Item: tier
      })
      .promise();
  } catch (err) {
    await dynamo
      .delete({
        TableName: TABLE_NAME,
        Key: { PK: bookPartition(ownerId), SK: bookSortKey(bookId) }
      })
      .promise();
    throw err;
  }

  const book = await loadBook(ownerId, bookId);
  return created(book ?? toClientBook(item, [tier]));
}

async function updateBook(ownerId: string, bookId: string, event: APIGatewayProxyEventV2) {
  const payload = parseBody<Partial<BookPayload>>(event) || {};
  if (payload.copies !== undefined && payload.copiesOnHand === undefined) {
    payload.copiesOnHand = payload.copies;
  }

  const updates: string[] = [];
  const names: DocumentClient.ExpressionAttributeNameMap = {};
  const values: DocumentClient.ExpressionAttributeValueMap = {};
  const now = new Date().toISOString();

  const allowed: (keyof BookPayload)[] = ['title', 'author', 'format', 'notes'];
  for (const key of allowed) {
    const value = payload[key];
    if (value !== undefined) {
      const name = `#${key}`;
      const val = `:${key}`;
      updates.push(`${name} = ${val}`);
      names[name] = key;
      values[val] = key === 'title' && typeof value === 'string' ? value.trim() : value;
    }
  }

  if (payload.title !== undefined) {
    updates.push('#normalizedTitle = :normalizedTitle');
    names['#normalizedTitle'] = 'normalizedTitle';
    values[':normalizedTitle'] = normalizeValue(payload.title as string);
  }
  if (payload.author !== undefined) {
    updates.push('#normalizedAuthor = :normalizedAuthor');
    names['#normalizedAuthor'] = 'normalizedAuthor';
    values[':normalizedAuthor'] = normalizeValue(payload.author as string);
  }
  if (payload.format !== undefined) {
    updates.push('#normalizedFormat = :normalizedFormat');
    names['#normalizedFormat'] = 'normalizedFormat';
    values[':normalizedFormat'] = normalizeFormat(payload.format as string);
  }

  if (!updates.length) {
    return badRequest('No valid fields to update');
  }

  updates.push('#updatedAt = :updatedAt');
  names['#updatedAt'] = 'updatedAt';
  values[':updatedAt'] = now;

  await dynamo
    .update({
      TableName: TABLE_NAME,
      Key: {
        PK: bookPartition(ownerId),
        SK: bookSortKey(bookId)
      },
      UpdateExpression: 'SET ' + updates.join(', '),
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ReturnValues: 'NONE'
    })
    .promise();

  const book = await loadBook(ownerId, bookId);
  if (!book) {
    return badRequest('Book not found');
  }
  return ok(book);
}

async function deleteBook(ownerId: string, bookId: string) {
  const res = await dynamo
    .query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': bookPartition(ownerId),
        ':sk': bookSortKey(bookId)
      }
    })
    .promise();

  const items = res.Items ?? [];
  if (!items.length) {
    await dynamo
      .delete({
        TableName: TABLE_NAME,
        Key: {
          PK: bookPartition(ownerId),
          SK: bookSortKey(bookId)
        }
      })
      .promise();
    return noContent();
  }

  while (items.length) {
    const batch = items.splice(0, 25).map((item) => ({
      DeleteRequest: {
        Key: { PK: (item as any).PK, SK: (item as any).SK }
      }
    }));

    await dynamo
      .batchWrite({
        RequestItems: {
          [TABLE_NAME]: batch as DocumentClient.WriteRequests
        }
      })
      .promise();
  }

  return noContent();
}

async function adjustStock(ownerId: string, bookId: string, event: APIGatewayProxyEventV2) {
  const payload = parseBody<BookPayload>(event);
  const delta = Number(payload?.delta ?? 0);

  if (!Number.isFinite(delta) || delta === 0) {
    return badRequest('delta must be a non-zero number');
  }

  const candidateTierId = payload?.tierId ?? event.pathParameters?.['tierId'];
  const price = typeof payload?.price === 'number' ? Number(payload?.price) : undefined;

  let tier: PriceTierRecord | null = null;
  if (candidateTierId) {
    tier = await getTierRecord(ownerId, bookId, candidateTierId);
  }
  if (!tier && price !== undefined) {
    tier = await findTierByPrice(ownerId, bookId, price);
  }

  if (!tier) {
    return badRequest('Tier not found for adjustment');
  }

  await dynamo
    .update({
      TableName: TABLE_NAME,
      Key: {
        PK: bookPartition(ownerId),
        SK: tierSortKey(bookId, tier.tierId)
      },
      UpdateExpression:
        'SET copiesOnHand = if_not_exists(copiesOnHand, :zero) + :delta, #updatedAt = :updatedAt',
      ExpressionAttributeNames: { '#updatedAt': 'updatedAt' },
      ExpressionAttributeValues: {
        ':delta': delta,
        ':zero': 0,
        ':updatedAt': new Date().toISOString()
      }
    })
    .promise();

  console.info('tier.adjust', {
    ownerId,
    bookId,
    tierId: tier.tierId,
    delta
  });

  const book = await loadBook(ownerId, bookId);
  if (!book) {
    return badRequest('Book not found');
  }
  return ok(book);
}

async function createTier(ownerId: string, bookId: string, event: APIGatewayProxyEventV2) {
  const payload = parseBody<BookPayload>(event);
  if (!payload) {
    return badRequest('Invalid tier payload');
  }

  const price = Number(payload.price ?? 0);
  if (!Number.isFinite(price)) {
    return badRequest('Price must be a number');
  }

  const copies = Number(payload.copiesOnHand ?? payload.copies ?? 0) || 0;
  const tierNotes = payload.tierNotes ?? payload.notes ?? '';
  const now = new Date().toISOString();
  const tierId = randomUUID();

  const existing = await loadBook(ownerId, bookId);
  if (!existing) {
    return badRequest('Book not found');
  }

  const tier: PriceTierRecord = {
    PK: bookPartition(ownerId),
    SK: tierSortKey(bookId, tierId),
    entityType: 'BOOK_TIER',
    ownerId,
    bookId,
    tierId,
    price,
    copiesOnHand: copies,
    notes: tierNotes,
    createdAt: now,
    updatedAt: now
  };

  await dynamo
    .put({
      TableName: TABLE_NAME,
      Item: tier
    })
    .promise();

  console.info('tier.create', { ownerId, bookId, tierId });

  const updated = await loadBook(ownerId, bookId);
  return created(updated ?? existing);
}

export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyStructuredResultV2> => {
  try {
    const ownerId = requireUserId(event);
    const method = event.requestContext.http?.method?.toUpperCase() ?? '';
    const path = event.rawPath ?? '';
    const bookId = event.pathParameters?.['id'];
    const tierId = event.pathParameters?.['tierId'];

    if (method === 'GET' && path === '/books') {
      return await listBooks(ownerId);
    }
    if (method === 'POST' && path === '/books') {
      return await createBook(ownerId, event);
    }
    if (method === 'PUT' && bookId) {
      return await updateBook(ownerId, bookId, event);
    }
    if (method === 'DELETE' && bookId && !path.endsWith('/adjust-stock')) {
      return await deleteBook(ownerId, bookId);
    }
    if (method === 'POST' && bookId && path.endsWith('/tiers')) {
      return await createTier(ownerId, bookId, event);
    }
    if (method === 'POST' && bookId && path.endsWith('/adjust-stock')) {
      return await adjustStock(ownerId, bookId, event);
    }

    return badRequest('Unsupported route');
  } catch (err: any) {
    console.error('books handler error', err);
    const message = err?.message || 'Internal error';
    if (message === 'Unauthorized') {
      return unauthorized();
    }
    return serverError(message);
  }
};
