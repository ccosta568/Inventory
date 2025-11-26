import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Observable } from 'rxjs';
import { Book } from '../model/book.model';
import { InventoryStoreService } from '../services/inventory-store.service';

@Component({
  selector: 'app-show-mode',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './show-mode.component.html',
  styleUrls: ['./show-mode.component.scss']
})
export class ShowModeComponent {
  readonly books$: Observable<Book[]> = this.store.books$;

  eventName = '';
  eventDate = new Date().toISOString().split('T')[0];
  notes = '';
  saving = false;
  message: string | null = null;
  error: string | null = null;

  selections: Record<string, number> = {};

  constructor(private store: InventoryStoreService) {}

  adjustSelection(bookId: string, delta: number) {
    const current = this.selections[bookId] || 0;
    const next = Math.max(0, current + delta);
    if (next === 0) {
      delete this.selections[bookId];
    } else {
      this.selections[bookId] = next;
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

    const lines = Object.entries(this.selections).map(([bookId, qty]) => ({
      bookId,
      qtySold: qty
    }));

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
