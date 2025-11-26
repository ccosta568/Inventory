const express = require('express');
const bodyParser = require('body-parser');
const { handler } = require('./dist/index');

const app = express();
app.use(bodyParser.json());

function makeEvent(req, rawPath, params) {
  const path = rawPath || req.path;
  const rawQueryString = req.originalUrl.includes('?') ? req.originalUrl.split('?')[1] : '';
  const body =
    typeof req.body === 'string'
      ? req.body
      : Object.keys(req.body || {}).length > 0
        ? JSON.stringify(req.body)
        : undefined;

  const qs = req.query || {};
  const queryStringParameters = Object.keys(qs).length ? qs : undefined;

  return {
    version: '2.0',
    routeKey: `${req.method.toUpperCase()} ${path}`,
    rawPath: path,
    rawQueryString,
    headers: req.headers,
    queryStringParameters,
    pathParameters: params || {},
    body,
    requestContext: {
      http: {
        method: req.method.toUpperCase(),
        path,
        sourceIp: req.ip || '127.0.0.1',
        userAgent: req.get('user-agent') || 'dev-server'
      }
    }
  };
}

async function runHandler(evt, res) {
  try {
    const result = await handler(evt);
    const payload = result.body && typeof result.body === 'string' && result.body.length > 0 ? JSON.parse(result.body) : {};
    res.status(result.statusCode || 200).json(payload);
  } catch (err) {
    console.error('handler error', err);
    res.status(500).json({ message: err.message || 'Internal error' });
  }
}

app.get('/books', (req, res) => {
  runHandler(makeEvent(req, '/books'), res);
});

app.post('/books', (req, res) => {
  runHandler(makeEvent(req, '/books'), res);
});

app.put('/books/:id', (req, res) => {
  runHandler(makeEvent(req, `/books/${req.params.id}`, { id: req.params.id }), res);
});

app.post('/books/:id/adjust-stock', (req, res) => {
  runHandler(makeEvent(req, `/books/${req.params.id}/adjust-stock`, { id: req.params.id }), res);
});

const port = process.env.PORT || 3002;
app.listen(port, () => console.log(`Dev backend listening on http://localhost:${port}`));
