export interface PriceTier {
  bookId: string;
  tierId: string;
  price: number;
  copiesOnHand: number;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Book {
  id: string;
  title: string;
  author?: string;
  format: string;
  notes: string;
  priceTiers: PriceTier[];
  totalOnHand: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface EventSaleLine {
  bookId: string;
  tierId?: string;
  price?: number;
  qtySold: number;
  revenue?: number;
}

export interface EventSale {
  id: string;
  eventName: string;
  date: string; // ISO string
  lines: EventSaleLine[];
  notes?: string;
  appliedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}
