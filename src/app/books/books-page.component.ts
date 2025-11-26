import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Observable } from 'rxjs';
import { InventoryStoreService, SyncStatus } from '../services/inventory-store.service';
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

  newBook: Partial<Book> = {
    title: '',
    author: '',
    format: 'paperback',
    price: undefined,
    copiesOnHand: 0,
    notes: ''
  };

  saving = false;
  manualSyncing = false;
  perBookSaving: Record<string, boolean> = {};
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
      const partial: Omit<Book, 'id'> = {
        title: this.newBook.title.trim(),
        author: this.newBook.author?.trim(),
        format: (this.newBook.format as Book['format']) || 'paperback',
        price: Number(this.newBook.price ?? 0),
        copiesOnHand: Number(this.newBook.copiesOnHand ?? 0),
        notes: this.newBook.notes?.trim() ?? ''
      };
      await this.store.addBook(partial);
      this.newBook = { title: '', author: '', format: 'paperback', price: undefined, copiesOnHand: 0, notes: '' };
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

  async handleAdjust(event: { bookId: string; delta: number }) {
    const { bookId, delta } = event;
    this.perBookSaving[bookId] = true;
    this.error = null;
    try {
      await this.store.adjustCopies(bookId, delta);
    } catch (err: any) {
      console.error('Failed to adjust stock', err);
      this.error = err?.message || 'Failed to adjust stock';
    } finally {
      this.perBookSaving[bookId] = false;
    }
  }

  confirmRemove(bookId: string) {
    const book = this.store.getBookById(bookId);
    const name = book?.title || 'this book';
    if (!confirm(`Remove ${name} from your local inventory? This cannot be undone.`)) {
      return;
    }
    this.store.deleteBook(bookId);
  }
}
