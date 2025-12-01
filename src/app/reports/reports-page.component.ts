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
  totalRevenue: number;
  bestSellers: BookReport[];
}

interface TierBreakdown {
  tierId?: string;
  price: number;
  qty: number;
  revenue: number;
}

interface BookReport {
  bookId: string;
  title: string;
  format?: string;
  totalUnits: number;
  totalRevenue: number;
  tiers: TierBreakdown[];
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
    const totalOnHand = books.reduce((sum, book) => sum + (book.totalOnHand ?? 0), 0);
    const bookLookup = new Map(books.map((book) => [book.id, book]));
    const aggregates = new Map<
      string,
      { totalUnits: number; totalRevenue: number; tiers: Map<string, TierBreakdown> }
    >();

    let totalUnits = 0;
    let totalRevenue = 0;

    events.forEach((event) => {
      event.lines?.forEach((line) => {
        const qty = Math.abs(line.qtySold ?? 0);
        if (!line.bookId || qty <= 0) {
          return;
        }
        const price = Number(line.price ?? 0);
        const bookId = line.bookId;
        if (!aggregates.has(bookId)) {
          aggregates.set(bookId, { totalUnits: 0, totalRevenue: 0, tiers: new Map() });
        }
        const aggregate = aggregates.get(bookId)!;
        aggregate.totalUnits += qty;
        aggregate.totalRevenue += qty * price;
        totalUnits += qty;
        totalRevenue += qty * price;

        const tierKey = line.tierId || `price-${price}`;
        const tier = aggregate.tiers.get(tierKey) || {
          tierId: line.tierId,
          price,
          qty: 0,
          revenue: 0
        };
        tier.qty += qty;
        tier.revenue += qty * price;
        aggregate.tiers.set(tierKey, tier);
      });
    });

    const bestSellers = Array.from(aggregates.entries())
      .map(([bookId, data]) => {
        const book = bookLookup.get(bookId);
        return {
          bookId,
          title: book?.title || bookId,
          format: book?.format,
          totalUnits: data.totalUnits,
          totalRevenue: data.totalRevenue,
          tiers: Array.from(data.tiers.values()).sort((a, b) => b.qty - a.qty)
        } as BookReport;
      })
      .sort((a, b) => b.totalUnits - a.totalUnits)
      .slice(0, 5);

    return {
      totalOnHand,
      eventCount: events.length,
      totalSold: totalUnits,
      totalRevenue,
      bestSellers
    };
  }
}
