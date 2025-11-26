import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';

interface Book {
  id: string;
  title: string;
  author: string;
  format: string;
  price: number;
  copies: number;
  notes: string;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': 'http://localhost:4200',
  'Access-Control-Allow-Headers': 'Content-Type,x-dev-user',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Content-Type': 'application/json'
};

const books: Book[] = [
  {
    id: '1',
    title: 'Test book from Lambda',
    author: 'Lambda',
    format: 'Paperback',
    price: 15,
    copies: 3,
    notes: 'Sample notes'
  }
];

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  console.log('Received event:', JSON.stringify(event, null, 2));

  const method = event.requestContext.http?.method?.toUpperCase() ?? '';

  if (method === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: corsHeaders,
      body: ''
    };
  }

  if (method === 'GET') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(books)
    };
  }

  if (method === 'POST') {
    let body: Partial<Book> = {};
    try {
      body = event.body ? (JSON.parse(event.body) as Partial<Book>) : {};
    } catch (err) {
      console.error('Failed to parse body', err);
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ message: 'Invalid JSON body' })
      };
    }

    const newBook: Book = {
      id: uuidv4(),
      title: body.title ?? '',
      author: body.author ?? '',
      format: body.format ?? 'Paperback',
      price: Number(body.price ?? 0),
      copies: Number(body.copies ?? 0),
      notes: body.notes ?? ''
    };

    books.push(newBook);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(newBook)
    };
  }

  return {
    statusCode: 405,
    headers: corsHeaders,
    body: JSON.stringify({ message: 'Method Not Allowed' })
  };
};
