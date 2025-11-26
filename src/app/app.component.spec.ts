import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AppComponent } from './app.component';
import { InventoryStoreService } from './services/inventory-store.service';

class InventoryStoreStub {
  syncStatus$ = of({ pending: false, queueSize: 0 });
  syncNow = () => Promise.resolve();
}

describe('AppComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        { provide: InventoryStoreService, useClass: InventoryStoreStub }
      ]
    }).compileComponents();
  });

  it('should create the app shell', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render the brand heading', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('Inventory & Sales');
  });
});
