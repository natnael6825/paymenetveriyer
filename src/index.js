// src/index.js
require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const logger  = require('./utils/logger');

const { verifyTelebirr } = require('./services/telebirrVerifier');
const { verifyCBE }      = require('./services/cbeVerifier');

const app = express();

// ─── CORS ─────────────────────────────────────────────────────────────────────
// Only allow your frontends at adeymart.com
const ALLOWED_ORIGINS = ['https://adeymart.com','https://www.adeymart.com'];
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // allow curl or server-to-server
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

      return res.json({
        provider: 'telebirr',
        paid,
        details: {
          payerName:             tele.payerName,
          payerTelebirrNo:       tele.payerTelebirrNo,
          creditedPartyName:     tele.creditedPartyName,
          creditedPartyAccountNo:tele.creditedPartyAccountNo,
          transactionStatus:     tele.transactionStatus,
          receiptNo:             tele.receiptNo,
          paymentDate:           tele.paymentDate,
          settledAmount:         tele.settledAmount,
          serviceFee:            tele.serviceFee,
          serviceFeeVAT:         tele.serviceFeeVAT,
          totalPaidAmount:       tele.totalPaidAmount
        }
      });
    }

    // 2) Fallback to CBE (treat transactionId as the full CBE ID)
    const cbeRaw = await verifyCBE(transactionId);
    const paidCBE = cbeRaw.success && cbeRaw.status === 'paid';

    // Map into the same structure as Telebirr
    return res.json({
      provider: 'cbe',
      paid: paidCBE,
      details: {
        payerName:             cbeRaw.payer            || null,
        payerTelebirrNo:       cbeRaw.payerAccount     || null,    // repurpose this field
        creditedPartyName:     cbeRaw.receiver         || null,    // repurpose
        creditedPartyAccountNo:cbeRaw.receiverAccount  || null,    // repurpose
        transactionStatus:     paidCBE ? 'Completed' : 'Unpaid',   // align naming
        receiptNo:             cbeRaw.reference        || null,
        paymentDate:           cbeRaw.date
                                  ? cbeRaw.date.toISOString()
                                  : null,
        settledAmount:         cbeRaw.amount != null
                                  ? `${cbeRaw.amount} ETB`
                                  : null,
        serviceFee:            null,
        serviceFeeVAT:         null,
        totalPaidAmount:       cbeRaw.amount != null
                                  ? `${cbeRaw.amount} ETB`
                                  : null
      }
    });

  } catch (err) {
    logger.error('Verification error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

const PORT = process.env.PORT || 6020;
app.listen(PORT, () =>
  logger.info(`🚀 Server listening on http://localhost:${PORT}`)
);
