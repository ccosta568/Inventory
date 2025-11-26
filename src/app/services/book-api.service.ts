import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, of, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { Book } from '../model/book.model';
import { environment } from '../../environments/environment';

interface RemoteBookItem {
  id: string;
  title?: string;
  author?: string;
  format?: string;
  price?: number;
  copies?: number;
  notes?: string;
}

@Injectable({ providedIn: 'root' })
export class BookApiService {
  private readonly base = (environment?.apiBaseUrl ?? '').replace(/\/$/, '');
  // TEMP DEV AUTH HEADER: replace with Cognito bearer token once auth returns.
  private readonly devHeaders = new HttpHeaders({ 'x-dev-user': 'dev-user' });

  constructor(private http: HttpClient) {}

  private normalize(item: RemoteBookItem | null | undefined): Book | null {
    if (!item?.id) return null;

    return {
      id: item.id,
      title: item.title || 'Untitled',
      author: item.author || '',
      format: item.format || 'Paperback',
      price: typeof item.price === 'number' ? item.price : 0,
      copiesOnHand: typeof item.copies === 'number' ? item.copies : 0,
      notes: item.notes ?? '',
      createdAt: new Date().toISOString()
    };
  }

  getBooks(): Observable<Book[]> {
    if (!this.base) {
      console.warn('[BookApi] No API base URL configured; returning empty list');
      return of([]);
    }

    return this.http
      .get<RemoteBookItem[]>(`${this.base}/books`, { headers: this.devHeaders })
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

  createBook(
    title: string,
    author: string,
    format: string,
    price: number,
    copies: number,
    notes: string
  ): Observable<Book> {
    if (!this.base) {
      return throwError(() => new Error('API base URL is not configured'));
    }
    const payload = { title, author, format, price, copies, notes };

    return this.http
      .post<RemoteBookItem | RemoteBookItem[]>(`${this.base}/books`, payload, { headers: this.devHeaders })
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
}
