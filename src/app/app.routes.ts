import { Routes } from '@angular/router';
import { BooksPageComponent } from './books/books-page.component';
import { ShowModeComponent } from './show-mode/show-mode.component';
import { ReportsPageComponent } from './reports/reports-page.component';
import { UnauthorizedComponent } from './unauthorized/unauthorized.component';
export const routes: Routes = [
  { path: '', redirectTo: 'books', pathMatch: 'full' },
  {
    path: 'books',
    component: BooksPageComponent
  },
  {
    path: 'show',
    component: ShowModeComponent
  },
  {
    path: 'reports',
    component: ReportsPageComponent
  },
  { path: 'unauthorized', component: UnauthorizedComponent }
];
