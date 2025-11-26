export type BookFormat = 'paperback' | 'hardcover' | 'ebook' | 'other';

export interface BookInput {
  title: string;
  format?: BookFormat;
  price?: number;
  copiesOnHand?: number;
  notes?: string;
}

export interface BookRecord extends BookInput {
  PK: string;
  SK: string;
  entityType: 'BOOK';
  ownerId: string;
  bookId: string;
  createdAt: string;
  updatedAt: string;
}

export interface EventLineInput {
  bookId: string;
  qtySold: number;
}

export interface EventInput {
  id?: string;
  eventName: string;
  date: string;
  lines: EventLineInput[];
  notes?: string;
}

export interface EventRecord extends EventInput {
  PK: string;
  SK: string;
  entityType: 'EVENT';
  ownerId: string;
  eventId: string;
  createdAt: string;
  updatedAt: string;
}

export interface EventLineRecord {
  PK: string;
  SK: string;
  entityType: 'EVENT_LINE';
  ownerId: string;
  eventId: string;
  bookId: string;
  qtySold: number;
  gsi1pk: string;
  gsi1sk: string;
  date: string;
}
