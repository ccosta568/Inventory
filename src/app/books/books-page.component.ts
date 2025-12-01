import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Observable } from 'rxjs';
import { InventoryStoreService, NewBookRequest, SyncStatus } from '../services/inventory-store.service';
import { Book } from '../model/book.model';
import { BookListComponent } from './components/book-list/book-list.component';

@Component({
  selector: 'app-books-page',
  standalone: true,
  imports: [CommonModule, FormsModule, BookListComponent],
  templateUrl: './books-page.component.html',
  styleUrls: ['./books-page.component.scss']
})
export class BooksPageComponent {
  readonly books$: Observable<Book[]> = this.store.books$;
  readonly syncStatus$: Observable<SyncStatus> = this.store.syncStatus$;

  newBook: NewBookRequest = {
    title: '',
    author: '',
    format: 'paperback',
    price: 0,
    copiesOnHand: 0,
    notes: '',
    tierNotes: ''
  };

  saving = false;
  manualSyncing = false;
  perBookSaving: Record<string, boolean> = {};
  perTierSaving: Record<string, boolean> = {};
  error: string | null = null;

  constructor(private store: InventoryStoreService) {}

  async addBook() {
    if (!this.newBook.title?.trim()) {
      this.error = 'Title is required.';
      return;
    }

    this.saving = true;
    this.error = null;
    try {
      const partial: NewBookRequest = {
        title: this.newBook.title.trim(),
        author: this.newBook.author?.trim(),
        format: (this.newBook.format as Book['format']) || 'paperback',
        price: Number(this.newBook.price ?? 0),
        copiesOnHand: Number(this.newBook.copiesOnHand ?? 0),
        notes: this.newBook.notes?.trim() ?? '',
        tierNotes: this.newBook.tierNotes?.trim() ?? ''
      };
      await this.store.addBook(partial);
      this.newBook = { title: '', author: '', format: 'paperback', price: 0, copiesOnHand: 0, notes: '', tierNotes: '' };
    } catch (err: any) {
      console.error('Failed to add book', err);
      this.error = err?.message || 'Failed to add book';
    } finally {
      this.saving = false;
    }
  }

  async triggerSync() {
    this.manualSyncing = true;
    this.error = null;
    try {
      await this.store.syncNow();
    } catch (err: any) {
      console.error('Manual sync failed', err);
      this.error = err?.message || 'Manual sync failed.';
    } finally {
      this.manualSyncing = false;
    }
  }

  async handleAdjust(event: { bookId: string; tierId: string; delta: number; price: number }) {
    const { bookId, tierId, delta, price } = event;
    const key = `${bookId}:${tierId}`;
    this.perTierSaving[key] = true;
    this.error = null;
    try {
      await this.store.adjustTierCopies(bookId, tierId, delta, price);
    } catch (err: any) {
      console.error('Failed to adjust stock', err);
      this.error = err?.message || 'Failed to adjust stock';
    } finally {
      delete this.perTierSaving[key];
    }
  }

  async handleAddTier(event: { bookId: string; price: number; copies: number; notes: string }) {
    const { bookId, price, copies, notes } = event;
    this.perBookSaving[bookId] = true;
    this.error = null;
    try {
      await this.store.addPriceTier(bookId, { price, copies, notes });
    } catch (err: any) {
      console.error('Failed to add price tier', err);
      this.error = err?.message || 'Failed to add price tier';
    } finally {
      this.perBookSaving[bookId] = false;
    }
  }

  async confirmRemove(bookId: string) {
    const book = this.store.getBookById(bookId);
    const name = book?.title || 'this book';
    if (
      !confirm(
        `Remove ${name} from your inventory? This deletes it from sync and cannot be undone.`
      )
    ) {
      return;
    }
    this.perBookSaving[bookId] = true;
    this.error = null;
    try {
      await this.store.deleteBook(bookId);
    } catch (err: any) {
      console.error('Failed to delete book', err);
      this.error = err?.message || 'Failed to delete book.';
    } finally {
      delete this.perBookSaving[bookId];
    }
  }
}
