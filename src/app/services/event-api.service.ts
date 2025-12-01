import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { EventSale } from '../model/book.model';
import { environment } from '../../environments/environment';

interface RemoteEventLine {
  bookId: string;
  qtySold: number;
  tierId?: string;
  price?: number;
  revenue?: number;
}

interface RemoteEventItem {
  id: string;
  eventName?: string;
  date?: string;
  lines?: RemoteEventLine[];
  notes?: string;
  appliedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

@Injectable({ providedIn: 'root' })
export class EventApiService {
  private readonly base = (environment?.apiBaseUrl ?? '').replace(/\/$/, '');

  constructor(private http: HttpClient) {}

  private normalize(item: RemoteEventItem | null | undefined): EventSale | null {
    if (!item?.id) return null;
    return {
      id: item.id,
      eventName: item.eventName ?? 'Untitled Event',
      date: item.date ?? new Date().toISOString(),
      lines: (item.lines || []).map((line) => ({
        bookId: line.bookId,
        tierId: line.tierId,
        price: line.price,
        revenue: line.revenue,
        qtySold: Number(line.qtySold ?? 0)
      })),
      notes: item.notes ?? '',
      appliedAt: item.appliedAt,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
    };
  }

  createEvent(payload: Omit<EventSale, 'id'> & { id?: string }): Observable<EventSale> {
    if (!this.base) {
      return throwError(() => new Error('API base URL is not configured'));
    }
    const body = {
      id: payload.id,
      eventName: payload.eventName,
      date: payload.date,
      lines: (payload.lines || []).map((line) => ({
        bookId: line.bookId,
        tierId: line.tierId,
        price: line.price,
        qtySold: Number(line.qtySold ?? 0)
      })),
      notes: payload.notes ?? ''
    };

    return this.http.post<RemoteEventItem>(`${this.base}/events`, body).pipe(
      map((item) => {
        const normalized = this.normalize(item);
        if (!normalized) {
          throw new Error('API returned an unexpected event shape');
        }
        return normalized;
      }),
      catchError((err) => {
        console.error('[EventApi] createEvent failed', err);
        return throwError(() => err);
      })
    );
  }

  applyEvent(eventId: string): Observable<void> {
    if (!this.base) {
      return throwError(() => new Error('API base URL is not configured'));
    }

    return this.http.post<void>(`${this.base}/events/${eventId}/apply`, {}).pipe(
      catchError((err) => {
        console.error('[EventApi] applyEvent failed', err);
        return throwError(() => err);
      })
    );
  }
}
