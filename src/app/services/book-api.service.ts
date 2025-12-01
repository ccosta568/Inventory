import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { Book, PriceTier } from '../model/book.model';
import { environment } from '../../environments/environment';

interface RemotePriceTier {
  bookId?: string;
  tierId: string;
  price?: number;
  copiesOnHand?: number;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface RemoteBookItem {
  id: string;
  title?: string;
  author?: string;
  format?: string;
  notes?: string;
  price?: number;
  copies?: number;
  copiesOnHand?: number;
  priceTiers?: RemotePriceTier[];
  totalOnHand?: number;
  createdAt?: string;
  updatedAt?: string;
}

@Injectable({ providedIn: 'root' })
export class BookApiService {
  private readonly base = (environment?.apiBaseUrl ?? '').replace(/\/$/, '');

  constructor(private http: HttpClient) {}

  private normalize(item: RemoteBookItem | null | undefined): Book | null {
    if (!item?.id) return null;

    const tiers: PriceTier[] = (item.priceTiers || []).map((tier) => ({
      bookId: tier.bookId || item.id,
      tierId: tier.tierId,
      price: Number(tier.price ?? 0),
      copiesOnHand: Number(tier.copiesOnHand ?? 0),
      notes: tier.notes ?? '',
      createdAt: tier.createdAt,
      updatedAt: tier.updatedAt
    }));

    if (!tiers.length) {
      const fallbackCopies =
        typeof item.copies === 'number'
          ? item.copies
          : typeof item.copiesOnHand === 'number'
            ? item.copiesOnHand
            : 0;
      tiers.push({
        bookId: item.id,
        tierId: item.id,
        price: Number(item.price ?? 0),
        copiesOnHand: fallbackCopies,
        notes: item.notes ?? '',
        createdAt: item.createdAt,
        updatedAt: item.updatedAt
      });
    }

    const totalOnHand =
      typeof item.totalOnHand === 'number'
        ? item.totalOnHand
        : tiers.reduce((sum, tier) => sum + tier.copiesOnHand, 0);

    return {
      id: item.id,
      title: item.title || 'Untitled',
      author: item.author || '',
      format: item.format || 'Paperback',
      notes: item.notes ?? '',
      priceTiers: tiers,
      totalOnHand,
      createdAt: item.createdAt ?? new Date().toISOString(),
      updatedAt: item.updatedAt ?? item.createdAt
    };
  }

  getBooks(): Observable<Book[]> {
    if (!this.base) {
      console.warn('[BookApi] No API base URL configured; returning empty list');
      return of([]);
    }

    return this.http
      .get<RemoteBookItem[]>(`${this.base}/books`)
      .pipe(
        map((items) =>
          (items || [])
            .map((item) => this.normalize(item))
            .filter((book): book is Book => !!book)
        ),
        catchError((err) => {
          console.error('[BookApi] getBooks failed', err);
          return throwError(() => err);
        })
      );
  }

  createBook(payload: {
    title: string;
    author?: string;
    format: string;
    price: number;
    copies: number;
    notes?: string;
    tierNotes?: string;
  }): Observable<Book> {
    if (!this.base) {
      return throwError(() => new Error('API base URL is not configured'));
    }
    const body = {
      title: payload.title,
      author: payload.author,
      format: payload.format,
      price: payload.price,
      copies: payload.copies,
      notes: payload.notes ?? '',
      tierNotes: payload.tierNotes ?? payload.notes ?? ''
    };

    return this.http
      .post<RemoteBookItem | RemoteBookItem[]>(`${this.base}/books`, body)
      .pipe(
        map((item) => {
          const candidate = Array.isArray(item) ? item[0] : item;
          const normalized = this.normalize(candidate);
          if (!normalized) {
            throw new Error('API returned an unexpected book shape');
          }
          return normalized;
        }),
        catchError((err) => {
          console.error('[BookApi] createBook failed', err);
          return throwError(() => err);
        })
      );
  }

  createPriceTier(bookId: string, tier: { price: number; copies: number; notes?: string }): Observable<Book> {
    if (!this.base) {
      return throwError(() => new Error('API base URL is not configured'));
    }

    const body = {
      price: tier.price,
      copies: tier.copies,
      copiesOnHand: tier.copies,
      notes: tier.notes ?? '',
      tierNotes: tier.notes ?? ''
    };

    return this.http
      .post<RemoteBookItem>(`${this.base}/books/${bookId}/tiers`, body)
      .pipe(
        map((item) => {
          const normalized = this.normalize(item);
          if (!normalized) {
            throw new Error('API returned an unexpected book shape');
          }
          return normalized;
        }),
        catchError((err) => {
          console.error('[BookApi] createPriceTier failed', err);
          return throwError(() => err);
        })
      );
  }

  deleteBook(id: string): Observable<void> {
    if (!this.base) {
      return throwError(() => new Error('API base URL is not configured'));
    }

    return this.http.delete<void>(`${this.base}/books/${id}`).pipe(
      catchError((err) => {
        console.error('[BookApi] deleteBook failed', err);
        return throwError(() => err);
      })
    );
  }

  adjustTierStock(bookId: string, tierId: string, delta: number, price?: number): Observable<Book> {
    if (!this.base) {
      return throwError(() => new Error('API base URL is not configured'));
    }
    const payload: Record<string, unknown> = { delta, tierId };
    if (typeof price === 'number') {
      payload['price'] = price;
    }

    return this.http
      .post<RemoteBookItem>(`${this.base}/books/${bookId}/adjust-stock`, payload)
      .pipe(
        map((item) => {
          const normalized = this.normalize(item);
          if (!normalized) {
            throw new Error('API returned an unexpected book shape');
          }
          return normalized;
        }),
        catchError((err) => {
          console.error('[BookApi] adjustTierStock failed', err);
          return throwError(() => err);
        })
      );
  }
}
