import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Book } from '../model/book.model';
import { InventoryStoreService } from '../services/inventory-store.service';

interface ShowCard {
  key: string;
  bookId: string;
  tierId: string;
  tierBookId: string;
  title: string;
  format: string;
  price: number;
  copiesOnHand: number;
  notes?: string;
}

@Component({
  selector: 'app-show-mode',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './show-mode.component.html',
  styleUrls: ['./show-mode.component.scss']
})
export class ShowModeComponent {
  readonly cards$: Observable<ShowCard[]> = this.store.books$.pipe(
    map((books) =>
      (books || []).flatMap((book) =>
        (book.priceTiers || [])
          .filter((tier) => (tier.copiesOnHand ?? 0) > 0)
          .map((tier) => ({
            key: `${tier.bookId || book.id}:${tier.tierId}`,
            bookId: book.id,
            tierId: tier.tierId,
            tierBookId: tier.bookId || book.id,
            title: book.title,
            format: book.format,
            price: tier.price,
            copiesOnHand: tier.copiesOnHand,
            notes: tier.notes
          }))
      )
    )
  );

  eventName = '';
  eventDate = new Date().toISOString().split('T')[0];
  notes = '';
  saving = false;
  message: string | null = null;
  error: string | null = null;

  selections: Record<string, number> = {};

  constructor(private store: InventoryStoreService) {}

  private tierKey(card: ShowCard): string {
    return card.key;
  }

  currentSelection(card: ShowCard): number {
    return this.selections[this.tierKey(card)] || 0;
  }

  canIncrement(card: ShowCard): boolean {
    return this.currentSelection(card) < card.copiesOnHand;
  }

  adjustSelection(card: ShowCard, delta: number) {
    const key = this.tierKey(card);
    const current = this.currentSelection(card);
    const max = Math.max(0, card.copiesOnHand);
    const next = Math.min(max, Math.max(0, current + delta));
    if (next === 0) {
      delete this.selections[key];
    } else {
      this.selections[key] = next;
    }
  }

  get hasSelection(): boolean {
    return Object.keys(this.selections).length > 0;
  }

  async logEvent() {
    if (!this.eventName.trim() || !this.eventDate) {
      this.error = 'Event name and date are required.';
      return;
    }
    if (!this.hasSelection) {
      this.error = 'Select at least one sale.';
      return;
    }

    const lines = Object.entries(this.selections)
      .map(([key, qty]) => {
        const [tierBookId, tierId] = key.split(':');
        const book = this.store.getBooks().find((candidate) =>
          candidate.priceTiers.some((tier) => tier.tierId === tierId)
        );
        const tier = book?.priceTiers.find((candidate) => candidate.tierId === tierId);
        if (tier) {
          return {
            bookId: tier.bookId || tierBookId,
            tierId,
            price: tier.price,
            qtySold: qty
          };
        }
        return null;
      })
      .filter((line): line is { bookId: string; tierId: string; price: number; qtySold: number } => !!line);

    if (!lines.length) {
      this.error = 'Selected price tiers could not be resolved. Please refresh inventory.';
      return;
    }

    this.saving = true;
    this.error = null;
    this.message = null;
    try {
      await this.store.addEventSale(
        {
          eventName: this.eventName.trim(),
          date: this.eventDate,
          lines,
          notes: this.notes || undefined
        },
        true
      );
      this.selections = {};
      this.eventName = '';
      this.notes = '';
      this.message = 'Event logged and applied to inventory.';
    } catch (err: any) {
      console.error('Failed to log event', err);
      this.error = err?.message || 'Failed to log event.';
    } finally {
      this.saving = false;
    }
  }
}
