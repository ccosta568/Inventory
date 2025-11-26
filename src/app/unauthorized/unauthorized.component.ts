import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-unauthorized',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <section class="unauthorized">
      <h1>Unauthorized</h1>
      <p>You do not have access to view this page.</p>
      <a routerLink="/">Return to home</a>
    </section>
  `,
  styles: [
    `
      .unauthorized {
        padding: 2rem;
        text-align: center;
      }

      .unauthorized h1 {
        margin-bottom: 1rem;
      }

      .unauthorized a {
        color: #1976d2;
        text-decoration: underline;
      }
    `,
  ],
})
export class UnauthorizedComponent {}
