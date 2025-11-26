import { Injectable } from '@angular/core';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { Book, EventSale, EventSaleLine } from '../model/book.model';
import { BookApiService } from './book-api.service';
import { environment } from '../../environments/environment';

interface InventoryState {
  books: Book[];
  events: EventSale[];
}

interface PendingCreate {
  tempId: string;
  title: string;
  author: string;
  format: string;
  price: number;
  copies: number;
  notes: string;
}

export interface SyncStatus {
  pending: boolean;
  queueSize: number;
  lastSuccess?: number;
  lastError?: string | null;
}

const STORAGE_KEY = 'authorInventory_v1';
const QUEUE_KEY = 'authorInventory_pending_v1';

@Injectable({ providedIn: 'root' })
export class InventoryStoreService {
  private state: InventoryState = { books: [], events: [] };

  private booksSubject = new BehaviorSubject<Book[]>([]);
  readonly books$ = this.booksSubject.asObservable();

  private eventsSubject = new BehaviorSubject<EventSale[]>([]);
  readonly events$ = this.eventsSubject.asObservable();

  private syncStatusSubject = new BehaviorSubject<SyncStatus>({ pending: false, queueSize: 0 });
  readonly syncStatus$ = this.syncStatusSubject.asObservable();

  private pendingCreates: PendingCreate[] = [];
  private syncing = false;

  constructor(private bookApi: BookApiService) {
    this.loadState();
    this.emitState();
    this.loadQueue();
    this.listenForOnline();
    void this.syncFromApi();
  }

  // ---------------------------------------------------------------------------
  // Persistence helpers
  // ---------------------------------------------------------------------------
  private hasStorage(): boolean {
    return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
  }

  private loadState(): void {
    if (!this.hasStorage()) return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        this.state = JSON.parse(raw);
      }
    } catch (err) {
      console.error('Failed to load inventory state', err);
      this.state = { books: [], events: [] };
    }
  }

  private saveState(): void {
    if (!this.hasStorage()) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
  }

  private emitState(): void {
    this.booksSubject.next([...this.state.books]);
    const events = [...this.state.events].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    this.eventsSubject.next(events);
  }

  private persistState(): void {
    this.saveState();
    this.emitState();
  }

  private loadQueue(): void {
    if (!this.hasStorage()) return;
    try {
      const raw = localStorage.getItem(QUEUE_KEY);
      if (raw) {
        this.pendingCreates = JSON.parse(raw);
      }
    } catch (err) {
      console.error('Failed to parse pending queue', err);
      this.pendingCreates = [];
    }
    this.updateSyncStatus();
  }

  private saveQueue(): void {
    if (!this.hasStorage()) return;
    localStorage.setItem(QUEUE_KEY, JSON.stringify(this.pendingCreates));
    this.updateSyncStatus();
  }

  private listenForOnline(): void {
    if (typeof window === 'undefined') return;
    window.addEventListener('online', () => void this.syncFromApi(true));
  }

  private isApiConfigured(): boolean {
    return !!environment?.apiBaseUrl;
  }

  // ---------------------------------------------------------------------------
  // Sync / queue management
  // ---------------------------------------------------------------------------
  async syncFromApi(force = false): Promise<void> {
    if (!this.isApiConfigured()) return;
    if (this.syncing && !force) return;

    this.syncing = true;
    this.updateSyncStatus(true);

    try {
      const books = await firstValueFrom(this.bookApi.getBooks());
      if (Array.isArray(books) && books.length) {
        // Merge remote records with existing local metadata (notes/format/etc.)
        const merged = books.map((remote) => {
          const local = this.state.books.find((b) => b.id === remote.id);
          return { ...local, ...remote };
        });
        this.state.books = merged;
        this.persistState();
      }
      await this.flushPendingCreates();
      this.updateSyncStatus(false, Date.now());
    } catch (err: any) {
      console.error('Failed to sync books', err);
      this.updateSyncStatus(false, undefined, err?.message || 'Unable to sync with API.');
    } finally {
      this.syncing = false;
    }
  }

  private async flushPendingCreates(): Promise<void> {
    if (!this.isApiConfigured()) return;
    if (!this.pendingCreates.length) return;

    const queue = [...this.pendingCreates];
    this.pendingCreates = [];
    this.saveQueue();

    for (const item of queue) {
      try {
        const remote = await firstValueFrom(
          this.bookApi.createBook(
            item.title,
            item.author ?? '',
            item.format ?? 'paperback',
            item.price ?? 0,
            item.copies ?? 0,
            item.notes ?? ''
          )
        );
        this.replaceTempBook(item.tempId, remote);
      } catch (err) {
        console.error('Failed to flush book create, re-queueing', err);
        this.pendingCreates.push(item);
      }
    }

    this.saveQueue();
  }

  private updateSyncStatus(pending = false, lastSuccess?: number, lastError?: string | null): void {
    this.syncStatusSubject.next({
      pending,
      queueSize: this.pendingCreates.length,
      lastSuccess: lastSuccess ?? this.syncStatusSubject.value.lastSuccess,
      lastError: lastError ?? null
    });
  }

  async syncNow(): Promise<void> {
    await this.syncFromApi(true);
  }

  // ---------------------------------------------------------------------------
  // Books
  // ---------------------------------------------------------------------------
  getBooks(): Book[] {
    return [...this.state.books];
  }

  getBookById(id: string): Book | undefined {
    return this.state.books.find((b) => b.id === id);
  }

  private upsertBook(book: Book): void {
    const idx = this.state.books.findIndex((b) => b.id === book.id);
    if (idx === -1) {
      this.state.books.push(book);
    } else {
      this.state.books[idx] = { ...this.state.books[idx], ...book };
    }
    this.persistState();
  }

  private replaceTempBook(tempId: string, remote: Book): void {
    const idx = this.state.books.findIndex((b) => b.id === tempId);
    if (idx === -1) {
      this.state.books.push(remote);
    } else {
      this.state.books[idx] = { ...this.state.books[idx], ...remote, id: remote.id };
    }
    this.persistState();
  }

  private generateId(): string {
    try {
      return crypto.randomUUID();
    } catch {
      return Math.random().toString(36).slice(2) + Date.now().toString(36);
    }
  }

  async addBook(partial: Omit<Book, 'id'>): Promise<Book> {
    const temp: Book = {
      id: this.generateId(),
      title: partial.title,
      author: partial.author,
      format: partial.format ?? 'paperback',
      price: partial.price ?? 0,
      copiesOnHand: partial.copiesOnHand ?? 0,
      notes: partial.notes ?? ''
    };
    this.upsertBook(temp);

    const apiPayload = {
      title: temp.title,
      author: temp.author ?? '',
      format: temp.format,
      price: temp.price ?? 0,
      copies: temp.copiesOnHand ?? 0,
      notes: temp.notes ?? ''
    };

    if (!this.isApiConfigured()) {
      return temp;
    }

    try {
      const remote = await firstValueFrom(
        this.bookApi.createBook(
          apiPayload.title,
          apiPayload.author,
          apiPayload.format,
          apiPayload.price,
          apiPayload.copies,
          apiPayload.notes
        )
      );
      this.replaceTempBook(temp.id, remote);
      return remote;
    } catch (err) {
      console.warn('API create failed, queued for retry.', err);
      this.pendingCreates.push({ tempId: temp.id, ...apiPayload });
      this.saveQueue();
      this.updateSyncStatus();
      return temp;
    }
  }

  async updateBook(id: string, changes: Partial<Omit<Book, 'id'>>): Promise<Book | null> {
    const existing = this.getBookById(id);
    if (!existing) return null;
    const updated = { ...existing, ...changes };
    this.upsertBook(updated);
    return updated;
  }

  async adjustCopies(id: string, delta: number): Promise<Book | null> {
    const book = this.getBookById(id);
    if (!book) return null;
    const next = Math.max(0, (book.copiesOnHand ?? 0) + delta);
    const updated = { ...book, copiesOnHand: next };
    this.upsertBook(updated);
    return updated;
  }

  deleteBook(id: string): void {
    this.state.books = this.state.books.filter((b) => b.id !== id);
    this.persistState();
  }

  // ---------------------------------------------------------------------------
  // Events (local only for show mode/reporting)
  // ---------------------------------------------------------------------------
  getEvents(): EventSale[] {
    return [...this.eventsSubject.value];
  }

  addEventSale(partial: Omit<EventSale, 'id'>, applyToInventory = true): EventSale {
    const event: EventSale = { id: this.generateId(), ...partial };
    this.state.events.push(event);
    if (applyToInventory) {
      this.applyEventToInventory(event);
    }
    this.persistState();
    return event;
  }

  async applyEvent(eventId: string): Promise<void> {
    const event = this.state.events.find((e) => e.id === eventId);
    if (!event) return;
    this.applyEventToInventory(event);
  }

  private applyEventToInventory(event: EventSale): void {
    event.lines?.forEach((line) => this.decrementLocalCopies(line));
    this.persistState();
  }

  private decrementLocalCopies(line: EventSaleLine): void {
    if (!line.bookId || !line.qtySold) return;
    const book = this.getBookById(line.bookId);
    if (!book) return;
    const next = Math.max(0, (book.copiesOnHand ?? 0) - Math.abs(line.qtySold));
    this.upsertBook({ ...book, copiesOnHand: next });
  }

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------
  exportState(): string {
    return JSON.stringify(this.state, null, 2);
  }

  importState(json: string): void {
    const parsed = JSON.parse(json) as InventoryState;
    if (!parsed || !Array.isArray(parsed.books) || !Array.isArray(parsed.events)) {
      throw new Error('Invalid inventory data');
    }
    this.state = parsed;
    this.persistState();
  }

  clearAll(): void {
    this.state = { books: [], events: [] };
    this.pendingCreates = [];
    this.saveQueue();
    this.persistState();
  }
}
