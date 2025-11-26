export interface Book {
  id: string;
  title: string;
  author?: string;
  format: string;
  price: number;
  copiesOnHand: number;
  notes: string;
  createdAt?: string;
}

export interface EventSaleLine {
  bookId: string;
  qtySold: number;
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
