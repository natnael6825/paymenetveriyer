require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const logger  = require('./utils/logger');

const { verifyTelebirr } = require('./services/telebirrVerifier');
const { verifyCBE }      = require('./services/cbeVerifier');

    const expectedCBEAccount = '1000281578859';
    const expectedCBEName    = 'YEGETA CHERINET NEGASH';
          const expectedTelebirrNo = '251919049024'; // full version of 0935148825
      const expectedName       = 'yegeta cherenet negash';

      

const app = express();

app.use(express.json());


// ─── CORS ─────────────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = ['https://adeymart.com', 'https://www.adeymart.com'];
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // allow curl/server-to-server
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    callback(new Error(`CORS policy: Origin '${origin}' not allowed`));
  },
  methods: ['GET'],
  allowedHeaders: ['Content-Type']
}));
// ──────────────────────────────────────────────────────────────────────────────

// Helper to match masked accounts
function isExpectedMaskedMatch(actualMasked, expectedFull) {
  if (!actualMasked || !expectedFull) return false;

  const cleanActual = actualMasked.replace(/\s/g, '');
  const cleanExpected = expectedFull.replace(/\s/g, '');

  const actualFirst4 = cleanActual.slice(0, 4).replace(/\*/g, '');
  const actualLast4  = cleanActual.slice(-4);
  const expectedFirst4 = cleanExpected.slice(0, 4);
  const expectedLast4  = cleanExpected.slice(-4);

  return (
    actualLast4 === expectedLast4 &&
    actualFirst4 && expectedFirst4 &&
    expectedFirst4.includes(actualFirst4)
  );
}

app.post('/verify', async (req, res) => {
  let  transactionId  = req.body.transactionId;

 transactionId=transactionId.toUpperCase();

  if (!transactionId) {
    return res.status(400).json({ error: '`transactionId` is required' });
  }

  try {
    // ─── TELEBIRR CHECK ──────────────────────────────────────
    const tele = await verifyTelebirr(transactionId);
    if (tele && tele.receiptNo) {
      const status = tele.transactionStatus?.toLowerCase();
      let paid = status === 'completed' || status === 'success';



      const nameMatch    = tele.creditedPartyName?.toLowerCase() === expectedName.toLowerCase();
      const accountMatch = isExpectedMaskedMatch(tele.creditedPartyAccountNo, expectedTelebirrNo);


 if (paid && nameMatch && accountMatch) {
        paid=true 
      } else {
        paid= false 
      }

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

    if (transactionId.length < 15) {
  transactionId += '81578859';
}


    // ─── CBE CHECK ────────────────────────────────────────────
    const cbe = await verifyCBE(transactionId);
    let paidCBE = cbe.success && cbe.status === 'paid';




    const nameMatch    = cbe.receiver?.toLowerCase() === expectedCBEName.toLowerCase();
    const accountMatch = isExpectedMaskedMatch(cbe.receiverAccount, expectedCBEAccount);


 if (paidCBE && nameMatch && accountMatch) {
        paidCBE=true 
      } else {
        paidCBE= false 
      }



    return res.json({
      provider: 'cbe',
      paid: paidCBE,

      details: {
        payerName:             cbe.payer            || null,
        payerTelebirrNo:       cbe.payerAccount     || null,
        creditedPartyName:     cbe.receiver         || null,
        creditedPartyAccountNo:cbe.receiverAccount  || null,
        transactionStatus:     paidCBE ? 'Completed' : 'Unpaid',
        receiptNo:             cbe.reference        || null,
        paymentDate:           cbe.date ? cbe.date.toISOString() : null,
        settledAmount:         cbe.amount != null ? `${cbe.amount} ETB` : null,
        serviceFee:            null,
        serviceFeeVAT:         null,
        totalPaidAmount:       cbe.amount != null ? `${cbe.amount} ETB` : null
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
