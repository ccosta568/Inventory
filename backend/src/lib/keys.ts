const DEFAULT_OWNER = 'public';

export function ownerPartition(ownerId?: string): string {
  return ownerId ? ownerId : DEFAULT_OWNER;
}

export function bookPartition(ownerId: string): string {
  return `BOOK#${ownerPartition(ownerId)}`;
}

export function bookSortKey(bookId: string): string {
  return `BOOK#${bookId}`;
}

export function eventPartition(ownerId: string): string {
  return `EVENT#${ownerPartition(ownerId)}`;
}

export function eventSortKey(dateIso: string, eventId: string): string {
  return `EVENT#${dateIso}#${eventId}`;
}

export function eventLinePartition(ownerId: string, eventId: string): string {
  return `EVENTLINE#${ownerPartition(ownerId)}#${eventId}`;
}

export function eventLineSortKey(index: number, bookId: string): string {
  return `LINE#${index.toString().padStart(4, '0')}#${bookId}`;
}

export function gsiEventMeta(ownerId: string, eventId: string): string {
  return `EVENT#${ownerPartition(ownerId)}#${eventId}`;
}

export function gsiBookEvent(ownerId: string, bookId: string): string {
  return `BOOK#${ownerPartition(ownerId)}#${bookId}`;
}

export const EVENT_META_GSI_SK = 'META';
