import { Injectable } from '@angular/core';
import { HttpEvent, HttpHandler, HttpInterceptor, HttpRequest } from '@angular/common/http';
import { Router } from '@angular/router';
import { OidcSecurityService } from 'angular-auth-oidc-client';
import { Observable, throwError } from 'rxjs';
import { catchError, switchMap, take } from 'rxjs/operators';

import { environment } from '../../environments/environment';

@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  private readonly apiBase = (environment.apiBaseUrl ?? '').replace(/\/$/, '');

  constructor(private oidcSecurityService: OidcSecurityService, private router: Router) {}

  intercept(req: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    if (!this.apiBase || !req.url.startsWith(this.apiBase)) {
      return next.handle(req);
    }

    return this.oidcSecurityService.getAccessToken().pipe(
      take(1),
      switchMap((token) => {
        const authReq = token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;
        return next.handle(authReq);
      }),
      catchError((error) => {
        if (error?.status === 401) {
          void this.router.navigate(['/unauthorized']);
        }
        return throwError(() => error);
      })
    );
  }
}
