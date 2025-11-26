import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { combineLatest, Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { InventoryStoreService } from '../services/inventory-store.service';
import { Book, EventSale } from '../model/book.model';

interface ReportViewModel {
  totalOnHand: number;
  eventCount: number;
  totalSold: number;
  bestSellers: { title: string; qty: number }[];
}

@Component({
  selector: 'app-reports-page',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './reports-page.component.html',
  styleUrls: ['./reports-page.component.scss']
})
export class ReportsPageComponent {
  readonly report$: Observable<ReportViewModel> = combineLatest([
    this.store.books$,
    this.store.events$
  ]).pipe(
    map(([books, events]) => this.buildReport(books, events))
  );

  constructor(private store: InventoryStoreService) {}

  private buildReport(books: Book[], events: EventSale[]): ReportViewModel {
    const totalOnHand = books.reduce((sum, book) => sum + (book.copiesOnHand ?? 0), 0);
    const lookup = new Map(books.map((book) => [book.id, book.title]));
    const salesByBook = new Map<string, number>();

    events.forEach((event) => {
      event.lines?.forEach((line) => {
        const prev = salesByBook.get(line.bookId) ?? 0;
        salesByBook.set(line.bookId, prev + Math.abs(line.qtySold));
      });
    });

    const totalSold = Array.from(salesByBook.values()).reduce((sum, qty) => sum + qty, 0);
    const bestSellers = Array.from(salesByBook.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([bookId, qty]) => ({
        title: lookup.get(bookId) || bookId,
        qty
      }));

    return {
      totalOnHand,
      eventCount: events.length,
      totalSold,
      bestSellers
    };
  }
}
