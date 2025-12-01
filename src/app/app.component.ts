import { Component, OnInit } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AsyncPipe, NgIf } from '@angular/common';
import { map } from 'rxjs';
import { OidcSecurityService } from 'angular-auth-oidc-client';
import { InventoryStoreService } from './services/inventory-store.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, NgIf, AsyncPipe],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent implements OnInit {
  readonly syncStatus$ = this.store.syncStatus$;
  readonly isAuthenticated$ = this.oidcSecurityService.isAuthenticated$.pipe(map((result) => result.isAuthenticated));
  readonly userEmail$ = this.oidcSecurityService.userData$.pipe(
    map((result) => {
      const data = result?.userData as { email?: string } | undefined;
      return data?.email ?? null;
    })
  );

  constructor(private store: InventoryStoreService, private oidcSecurityService: OidcSecurityService) {}

  ngOnInit(): void {
    this.oidcSecurityService.checkAuth().subscribe();
  }

  login(): void {
    this.oidcSecurityService.authorize();
  }

  logout(): void {
    this.oidcSecurityService.logoffAndRevokeTokens().subscribe({
      next: (result) => {
        console.log('[Auth] Logged out', result);
      },
      error: (err) => {
        console.error('[Auth] Logout failed', err);
      }
    });
  }
}
