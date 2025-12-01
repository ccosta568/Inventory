import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Book, PriceTier } from '../../../model/book.model';

type TierFormState = { price: number | null; copies: number | null; notes: string };

@Component({
  selector: 'app-book-list',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './book-list.component.html',
  styleUrls: ['./book-list.component.scss']
})
export class BookListComponent {
  @Input() books: Book[] | null = [];
  @Input() bookSavingMap: Record<string, boolean> = {};
  @Input() tierSavingMap: Record<string, boolean> = {};

  @Output() adjustTier = new EventEmitter<{ bookId: string; tierId: string; delta: number; price: number }>();
  @Output() addTier = new EventEmitter<{ bookId: string; price: number; copies: number; notes: string }>();
  @Output() remove = new EventEmitter<string>();

  newTierState: Record<string, TierFormState> = {};

  private ensureTierState(bookId: string): TierFormState {
    if (!this.newTierState[bookId]) {
      this.newTierState[bookId] = { price: null, copies: null, notes: '' };
    }
    return this.newTierState[bookId];
  }

  getTierState(bookId: string): TierFormState {
    return this.ensureTierState(bookId);
  }

  trackById(_index: number, book: Book): string {
    return book.id;
  }

  tierKey(bookId: string, tierId: string): string {
    return `${bookId}:${tierId}`;
  }

  emitAdjustTier(book: Book, tier: PriceTier, delta: number): void {
    this.adjustTier.emit({
      bookId: tier.bookId || book.id,
      tierId: tier.tierId,
      delta,
      price: tier.price
    });
  }

  emitRemove(bookId: string): void {
    this.remove.emit(bookId);
  }

  updateTierState(bookId: string, key: keyof TierFormState, value: number | string): void {
    const existing = this.ensureTierState(bookId);
    this.newTierState[bookId] = { ...existing, [key]: value };
  }

  submitNewTier(bookId: string): void {
    const state = this.ensureTierState(bookId);
    const price = Number(state.price ?? 0);
    const copies = Number(state.copies ?? 0);
    if (price <= 0) {
      alert('Enter a valid price for the new tier.');
      return;
    }
    this.addTier.emit({ bookId, price, copies: Math.max(0, copies), notes: state.notes?.trim() || '' });
    this.newTierState[bookId] = { price: null, copies: null, notes: '' };
  }
}
