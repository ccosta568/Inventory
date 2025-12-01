export type BookFormat = 'paperback' | 'hardcover' | 'ebook' | 'other';

export interface BookInput {
  title: string;
  author?: string;
  format?: BookFormat;
  price?: number;
  copiesOnHand?: number;
  notes?: string;
  tierNotes?: string;
}

export interface BookRecord extends Omit<BookInput, 'tierNotes'> {
  PK: string;
  SK: string;
  entityType: 'BOOK';
  ownerId: string;
  bookId: string;
  normalizedTitle?: string;
  normalizedAuthor?: string;
  normalizedFormat?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PriceTierInput {
  tierId?: string;
  price: number;
  copiesOnHand?: number;
  notes?: string;
}

export interface PriceTierRecord extends PriceTierInput {
  PK: string;
  SK: string;
  entityType: 'BOOK_TIER';
  ownerId: string;
  bookId: string;
  tierId: string;
  createdAt: string;
  updatedAt: string;
}

export interface EventLineInput {
  bookId: string;
  qtySold: number;
  tierId?: string;
  price?: number;
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
  tierId?: string;
  price?: number;
  revenue?: number;
  gsi1pk: string;
  gsi1sk: string;
  date: string;
}
