// src/index.js
require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const logger  = require('./utils/logger');

const { verifyTelebirr } = require('./services/telebirrVerifier');
const { verifyCBE }      = require('./services/cbeVerifier');

const app = express();

// ─── CORS: whitelist adeymart.com ─────────────────────────────────────────────
const ALLOWED_ORIGINS = ['https://adeymart.com','https://www.adeymart.com'];
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // allow curl / server‐to‐server
    if (ALLOWED_ORIGINS.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error(`CORS policy: Origin '${origin}' not allowed`));
  },
  methods: ['GET'],
  allowedHeaders: ['Content-Type']
}));
// ──────────────────────────────────────────────────────────────────────────────

app.get('/verify', async (req, res) => {
  const { transactionId } = req.query;
  if (!transactionId) {
    return res.status(400).json({ error: '`transactionId` is required' });
  }

  try {
    // 1) Telebirr first
    const tele = await verifyTelebirr(transactionId);
    if (tele && tele.receiptNo) {
      const st   = tele.transactionStatus.toLowerCase();
      const paid = (st === 'success' || st === 'completed');
      return res.json({ provider: 'telebirr', paid, details: tele });
    }

    // 2) Then CBE
    const cbe = await verifyCBE(transactionId);
    const paid  = cbe.success && cbe.status === 'paid';
    return res.json({ provider: 'cbe', paid, details: cbe });

  } catch (e) {
    logger.error('Verification error:', e);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

const PORT = process.env.PORT || 6020;
app.listen(PORT, () =>
  logger.info(`🚀 Server listening on http://localhost:${PORT}`)
);
