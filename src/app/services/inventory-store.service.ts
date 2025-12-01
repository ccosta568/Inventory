import { Injectable } from '@angular/core';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { OidcSecurityService } from 'angular-auth-oidc-client';
import { Book, EventSale, EventSaleLine, PriceTier } from '../model/book.model';
import { BookApiService } from './book-api.service';
import { EventApiService } from './event-api.service';
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
  tierNotes: string;
}

export interface NewBookRequest {
  title: string;
  author?: string;
  format: string;
  price: number;
  copiesOnHand: number;
  notes?: string;
  tierNotes?: string;
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
  private authenticated = false;

  constructor(
    private bookApi: BookApiService,
    private eventApi: EventApiService,
    private oidcSecurityService: OidcSecurityService
  ) {
    this.loadState();
    this.emitState();
    this.loadQueue();
    this.listenForOnline();
    this.bindToAuthentication();
  }

  private bindToAuthentication(): void {
    this.oidcSecurityService.isAuthenticated$.subscribe((result) => {
      const nextState = !!result?.isAuthenticated;
      const changed = nextState !== this.authenticated;
      this.authenticated = nextState;
      if (nextState && (changed || !this.state.books.length)) {
        void this.syncFromApi(true);
      }
    });
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
        if (Array.isArray(this.state.books)) {
          this.state.books = this.state.books.map((book: any) => {
            if (Array.isArray(book.priceTiers)) {
              return this.normalizeBook(book as Book);
            }
            const copies = Number(book.copiesOnHand ?? 0);
            const tier: PriceTier = {
              bookId: book.id ?? this.generateId(),
              tierId: book.id ?? this.generateId(),
              price: Number(book.price ?? 0),
              copiesOnHand: copies,
              notes: book.notes ?? ''
            };
            const legacy: Book = {
              id: book.id,
              title: book.title,
              author: book.author,
              format: book.format ?? 'paperback',
              notes: book.notes ?? '',
              priceTiers: [tier],
              totalOnHand: copies,
              createdAt: book.createdAt,
              updatedAt: book.updatedAt
            };
            return this.normalizeBook(legacy);
          });
          this.state.books = this.state.books.filter((book) => this.hasInventory(book));
        }
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
    const books = this.state.books.map((book) => ({
      ...book,
      priceTiers: book.priceTiers.map((tier) => ({ ...tier }))
    }));
    this.booksSubject.next(books);
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
        this.pendingCreates = (JSON.parse(raw) as PendingCreate[]).map((item) => ({
          ...item,
          tierNotes: item.tierNotes ?? item.notes ?? ''
        }));
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
    if (!this.authenticated) return;
    if (!this.isApiConfigured()) return;
    if (this.syncing && !force) return;

    this.syncing = true;
    this.updateSyncStatus(true);

    try {
      const books = await firstValueFrom(this.bookApi.getBooks());
      if (Array.isArray(books)) {
        // Merge remote records with existing local metadata for any un-synced fields
        const merged = books.map((remote) => {
          const local = this.state.books.find((b) => b.id === remote.id);
          return this.normalizeBook({ ...(local || {}), ...remote } as Book);
        });
        this.state.books = merged.filter((book) => this.hasInventory(book));
      } else {
        this.state.books = [];
      }
      this.persistState();
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
    if (!this.authenticated) return;
    if (!this.isApiConfigured()) return;
    if (!this.pendingCreates.length) return;

    const queue = [...this.pendingCreates];
    this.pendingCreates = [];
    this.saveQueue();

    for (const item of queue) {
      try {
        const remote = await firstValueFrom(
          this.bookApi.createBook(
            {
              title: item.title,
              author: item.author ?? '',
              format: item.format ?? 'paperback',
              price: item.price ?? 0,
              copies: item.copies ?? 0,
              notes: item.notes ?? '',
              tierNotes: item.tierNotes ?? item.notes ?? ''
            }
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
    return this.state.books.map((book) => ({
      ...book,
      priceTiers: book.priceTiers.map((tier) => ({ ...tier }))
    }));
  }

  getBookById(id: string): Book | undefined {
    return this.state.books.find((b) => b.id === id);
  }

  private normalizeBook(book: Book): Book {
    const tiers: PriceTier[] = (book.priceTiers || []).map((tier) => ({
      ...tier,
      bookId: tier.bookId || book.id,
      copiesOnHand: Math.max(0, Number(tier.copiesOnHand ?? 0))
    }));
    const totalOnHand = this.sumTierCopies(tiers);
    return {
      ...book,
      notes: book.notes ?? '',
      priceTiers: tiers,
      totalOnHand
    };
  }

  private sumTierCopies(tiers: PriceTier[] = []): number {
    return (tiers || []).reduce((sum, tier) => sum + Math.max(0, Number(tier.copiesOnHand ?? 0)), 0);
  }

  private hasInventory(book?: Book | null): boolean {
    if (!book) return false;
    const total = typeof book.totalOnHand === 'number' ? book.totalOnHand : this.sumTierCopies(book.priceTiers);
    return total > 0;
  }

  private normalizeIdentity(value?: string | null): string {
    return (value ?? '').trim().toLowerCase();
  }

  private buildIdentityKey(book: { title: string; author?: string; format?: string }): string {
    return `${this.normalizeIdentity(book.title)}|${this.normalizeIdentity(book.author)}|${this.normalizeIdentity(book.format ?? 'paperback')}`;
  }

  private findBookByIdentityLocal(partial: NewBookRequest): Book | undefined {
    const identity = this.buildIdentityKey(partial);
    return this.state.books.find((book) => this.buildIdentityKey(book) === identity);
  }

  private upsertBook(book: Book): void {
    const normalized = this.normalizeBook(book);
    const idx = this.state.books.findIndex((b) => b.id === book.id);
    if (idx === -1) {
      this.state.books.push(normalized);
    } else {
      this.state.books[idx] = { ...this.state.books[idx], ...normalized };
    }
    this.persistState();
  }

  private replaceTempBook(tempId: string, remote: Book): void {
    const idx = this.state.books.findIndex((b) => b.id === tempId);
    const normalized = this.normalizeBook(remote);
    if (idx === -1) {
      this.state.books.push(normalized);
    } else {
      this.state.books[idx] = { ...this.state.books[idx], ...normalized, id: normalized.id };
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

  private snapshotBooks(): Book[] {
    return this.state.books.map((book) => ({
      ...book,
      priceTiers: book.priceTiers.map((tier) => ({ ...tier }))
    }));
  }

  private restoreBooks(snapshot: Book[]): void {
    this.state.books = snapshot.map((book) => ({
      ...book,
      priceTiers: book.priceTiers.map((tier) => ({ ...tier }))
    }));
    this.persistState();
  }

  private replaceEvent(tempId: string, remote: EventSale): void {
    const idx = this.state.events.findIndex((event) => event.id === tempId);
    const cloned: EventSale = {
      ...remote,
      lines: (remote.lines || []).map((line) => ({ ...line }))
    };
    if (idx === -1) {
      this.state.events.push(cloned);
    } else {
      this.state.events[idx] = cloned;
    }
    this.persistState();
  }

  private markEventApplied(eventId: string, appliedAt?: string): void {
    const idx = this.state.events.findIndex((event) => event.id === eventId);
    if (idx === -1) return;
    this.state.events[idx] = {
      ...this.state.events[idx],
      appliedAt: appliedAt ?? new Date().toISOString()
    };
    this.persistState();
  }

  async addBook(partial: NewBookRequest): Promise<Book> {
    const price = Number(partial.price ?? 0);
    const copies = Math.max(0, Number(partial.copiesOnHand ?? 0));
    const tierNotes = partial.tierNotes ?? partial.notes ?? '';
    const existing = this.findBookByIdentityLocal(partial);

    if (existing) {
      const tier = existing.priceTiers.find((candidate) => candidate.price === price);
      if (tier) {
        await this.adjustTierCopies(tier.bookId || existing.id, tier.tierId, copies, price);
      } else {
        await this.addPriceTier(existing.id, { price, copies, notes: tierNotes });
      }
      return this.getBookById(existing.id) ?? existing;
    }

    const now = new Date().toISOString();
    const tierId = this.generateId();

    const tempId = this.generateId();
    const temp: Book = {
      id: tempId,
      title: partial.title,
      author: partial.author,
      format: partial.format ?? 'paperback',
      notes: partial.notes ?? '',
      priceTiers: [
        {
          bookId: tempId,
          tierId,
          price,
          copiesOnHand: copies,
          notes: tierNotes,
          createdAt: now,
          updatedAt: now
        }
      ],
      totalOnHand: copies,
      createdAt: now,
      updatedAt: now
    };
    this.upsertBook(temp);

    const apiPayload = {
      title: temp.title,
      author: temp.author ?? '',
      format: temp.format,
      price,
      copies,
      notes: temp.notes ?? '',
      tierNotes
    };

    if (!this.isApiConfigured()) {
      return temp;
    }

    try {
      const remote = await firstValueFrom(this.bookApi.createBook(apiPayload));
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

  async adjustTierCopies(bookId: string, tierId: string, delta: number, price?: number): Promise<Book | null> {
    const book =
      this.getBookById(bookId) ||
      this.state.books.find((candidate) => candidate.priceTiers.some((tier) => tier.tierId === tierId));
    if (!book) return null;
    const tier = book.priceTiers.find((t) => t.tierId === tierId);
    if (!tier) return null;

    const current = tier.copiesOnHand ?? 0;
    const next = Math.max(0, current + delta);
    const appliedDelta = next - current;
    if (appliedDelta === 0) {
      return book;
    }

    const updated: Book = {
      ...book,
      priceTiers: book.priceTiers.map((t) =>
        t.tierId === tierId ? { ...t, copiesOnHand: next, bookId } : t
      )
    };
    this.upsertBook(updated);

    if (!this.isApiConfigured()) {
      return updated;
    }

    try {
      const remote = await firstValueFrom(
        this.bookApi.adjustTierStock(bookId, tierId, appliedDelta, price ?? tier.price)
      );
      if (remote) {
        this.upsertBook(remote);
        return remote;
      }
      return updated;
    } catch (err) {
      this.upsertBook(book);
      throw err;
    }
  }

  async addPriceTier(
    bookId: string,
    tier: { price: number; copies: number; notes?: string }
  ): Promise<Book | null> {
    const book = this.getBookById(bookId);
    if (!book) return null;

    const now = new Date().toISOString();
    const localTier: PriceTier = {
      bookId,
      tierId: this.generateId(),
      price: Number(tier.price ?? 0),
      copiesOnHand: Math.max(0, Number(tier.copies ?? 0)),
      notes: tier.notes ?? '',
      createdAt: now,
      updatedAt: now
    };

    const updated: Book = {
      ...book,
      priceTiers: [...book.priceTiers, localTier]
    };
    this.upsertBook(updated);

    if (!this.isApiConfigured()) {
      return updated;
    }

    try {
      const remote = await firstValueFrom(
        this.bookApi.createPriceTier(bookId, {
          price: localTier.price,
          copies: localTier.copiesOnHand,
          notes: localTier.notes
        })
      );
      this.upsertBook(remote);
      return remote;
    } catch (err) {
      this.upsertBook(book);
      throw err;
    }
  }

  async deleteBook(id: string, options?: { suppressRevert?: boolean }): Promise<void> {
    const index = this.state.books.findIndex((b) => b.id === id);
    const existing = index >= 0 ? this.state.books[index] : undefined;
    this.state.books = this.state.books.filter((b) => b.id !== id);
    this.persistState();

    if (!this.isApiConfigured()) return;
    if (!existing) return;

    try {
      await firstValueFrom(this.bookApi.deleteBook(id));
    } catch (err) {
      console.error('Failed to delete book remotely', err);
      if (!options?.suppressRevert && existing) {
        this.state.books.splice(index, 0, existing);
        this.persistState();
      }
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Events (local only for show mode/reporting)
  // ---------------------------------------------------------------------------
  getEvents(): EventSale[] {
    return [...this.eventsSubject.value];
  }

  async addEventSale(partial: Omit<EventSale, 'id'>, applyToInventory = true): Promise<EventSale> {
    const event: EventSale = {
      id: this.generateId(),
      eventName: partial.eventName ?? '',
      date: partial.date,
      lines: (partial.lines || []).map((line) => ({
        bookId: line.bookId,
        tierId: line.tierId,
        price: line.price,
        qtySold: Number(line.qtySold ?? 0)
      })),
      notes: partial.notes ?? '',
      appliedAt: partial.appliedAt,
      createdAt: partial.createdAt,
      updatedAt: partial.updatedAt
    };
    const rollbackBooks = this.snapshotBooks();

    this.state.events.push(event);
    if (applyToInventory) {
      this.applyEventToInventory(event);
    } else {
      this.persistState();
    }

    if (!this.isApiConfigured()) {
      return event;
    }

    let remote: EventSale;
    try {
      remote = await firstValueFrom(
        this.eventApi.createEvent({
          id: event.id,
          eventName: event.eventName,
          date: event.date,
          lines: event.lines,
          notes: event.notes
        })
      );
    } catch (err) {
      this.state.events = this.state.events.filter((existing) => existing.id !== event.id);
      this.restoreBooks(rollbackBooks);
      throw err;
    }

    this.replaceEvent(event.id, remote);

    if (!applyToInventory) {
      return remote;
    }

    await this.applyEventRemote(remote.id, rollbackBooks);
    return remote;
  }

  async applyEvent(eventId: string): Promise<void> {
    const event = this.state.events.find((e) => e.id === eventId);
    if (!event) return;
    const rollbackBooks = this.snapshotBooks();
    this.applyEventToInventory(event);
    await this.applyEventRemote(eventId, rollbackBooks);
  }

  private applyEventToInventory(event: EventSale): void {
    event.lines?.forEach((line) => this.decrementLocalTierCopies(line));
    this.persistState();
  }

  private decrementLocalTierCopies(line: EventSaleLine): void {
    if (!line.bookId || !line.qtySold) return;
    const book = this.getBookById(line.bookId);
    if (!book) return;

    let tier: PriceTier | undefined;
    if (line.tierId) {
      tier = book.priceTiers.find((candidate) => candidate.tierId === line.tierId);
    }
    if (!tier && Number.isFinite(line.price)) {
      tier = book.priceTiers.find((candidate) => candidate.price === line.price);
    }
    if (!tier) {
      return;
    }

    const next = Math.max(0, (tier.copiesOnHand ?? 0) - Math.abs(line.qtySold));
    const updated: Book = {
      ...book,
      priceTiers: book.priceTiers.map((candidate) =>
        candidate.tierId === tier?.tierId
          ? { ...candidate, copiesOnHand: next, bookId: candidate.bookId || book.id }
          : candidate
      )
    };
    this.upsertBook(updated);

    const totalRemaining = this.sumTierCopies(updated.priceTiers);
    if (totalRemaining <= 0) {
      this
        .deleteBook(book.id, { suppressRevert: true })
        .catch((err) => console.error('Failed to remove depleted book', err));
    }
  }

  private async applyEventRemote(eventId: string, rollbackBooks: Book[]): Promise<void> {
    if (!this.isApiConfigured()) {
      return;
    }
    try {
      await firstValueFrom(this.eventApi.applyEvent(eventId));
      this.markEventApplied(eventId);
      await this.syncFromApi(true);
    } catch (err: any) {
      this.restoreBooks(rollbackBooks);
      const message = err?.message ? `Failed to apply event: ${err.message}` : 'Failed to apply event.';
      throw new Error(message);
    }
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
