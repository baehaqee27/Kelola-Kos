import 'dotenv/config';
import express from 'express';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import app from './api/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Static frontend (PWA)
app.use(
  express.static(resolve(__dirname, 'public'), {
    maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
  })
);

// SPA fallback for any non-API GET request.
app.get(/^\/(?!api\/).*/, (req, res) => {
  res.sendFile(resolve(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`KelolaKos berjalan di http://localhost:${PORT}`);
});
