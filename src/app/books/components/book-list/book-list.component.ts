import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Book } from '../../../model/book.model';

@Component({
  selector: 'app-book-list',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './book-list.component.html',
  styleUrls: ['./book-list.component.scss']
})
export class BookListComponent {
  @Input() books: Book[] | null = [];
  @Input() savingMap: Record<string, boolean> = {};

  @Output() adjust = new EventEmitter<{ bookId: string; delta: number }>();
  @Output() remove = new EventEmitter<string>();

  trackById(_index: number, book: Book): string {
    return book.id;
  }

  emitAdjust(bookId: string, delta: number): void {
    this.adjust.emit({ bookId, delta });
  }

  emitRemove(bookId: string): void {
    this.remove.emit(bookId);
  }
}
