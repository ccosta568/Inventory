import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AsyncPipe, JsonPipe, NgIf } from '@angular/common';
import { InventoryStoreService } from './services/inventory-store.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, NgIf, AsyncPipe, JsonPipe],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  readonly syncStatus$ = this.store.syncStatus$;
  isAuthenticated = true;
  userData: unknown = { mode: 'offline' };

  constructor(private store: InventoryStoreService) {}

  login(): void {
    console.warn('[Auth] Disabled for local development.');
  }

  logout(): void {
    console.warn('[Auth] Disabled for local development.');
  }
}
