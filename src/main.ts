import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';
import { environment } from './environments/environment';

bootstrapApplication(AppComponent, appConfig)
  .catch((err) => console.error(err));

if (environment.production && typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.error('Service worker registration failed', err);
    });
  });
}
