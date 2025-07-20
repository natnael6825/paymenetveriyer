require('dotenv').config();
const express = require('express');
const logger  = require('./utils/logger');
const cors    = require('cors');

const { verifyCBE }      = require('./services/cbeVerifier');
const { verifyTelebirr } = require('./services/telebirrVerifier');

const app = express();
const DEFAULT_SUFFIX = process.env.CBE_ACCOUNT_SUFFIX;

app.use(cors());   

app.get('/verify', async (req, res) => {
  const { transactionId, provider, accountSuffix } = req.query;

  if (!transactionId) {
    return res.status(400).json({ error: '`transactionId` is required' });
  }

  const prov = (provider || '').toLowerCase();

  async function checkTelebirr() {
    const receipt = await verifyTelebirr(transactionId);
    if (!receipt) return { name:'telebirr', paid:false, details:null };

    const st = receipt.transactionStatus.toLowerCase();
    const paid = (st === 'success' || st === 'completed');
    return { name:'telebirr', paid, details:receipt };
  }

  async function checkCBE(suffix) {
    const result = await verifyCBE(transactionId, suffix);
    const paid   = result.success && result.status === 'paid';
    return { name:'cbe', paid, details: result };
  }

  try {
    const results = [];

    // 1) Telebirr if requested or no provider specified
    if (!prov || prov === 'telebirr') {
      const t = await checkTelebirr();
      results.push(t);
      if (prov === 'telebirr' || t.paid) {
        return res.json({ paid: t.paid, checked: ['telebirr'], results: [t] });
      }
    }

    // 2) CBE if requested or (no provider and we gave an accountSuffix)
    const suffix = accountSuffix || DEFAULT_SUFFIX;
    if (!prov || prov === 'cbe') {
      if (!suffix) {
        return res.status(400).json({
          error: '`accountSuffix` is required for CBE (or set CBE_ACCOUNT_SUFFIX in .env)'
        });
      }
      const c = await checkCBE(suffix);
      results.push(c);
      if (prov === 'cbe' || c.paid) {
        return res.json({ paid: c.paid, checked: ['cbe'], results: [c] });
      }
    }

    // 3) If no one paid (or invalid provider)
    if (prov && prov !== 'telebirr' && prov !== 'cbe') {
      return res.status(400).json({ error: `invalid provider '${prov}'` });
    }

    const paidAny = results.some(r => r.paid);
    const checked = results.map(r => r.name);
    return res.json({ paid: paidAny, checked, results });

  } catch (e) {
    logger.error('Verification error:', e);
    return res.status(500).json({ error: e.message || 'Internal server error' });
  }
});

const PORT = process.env.PORT || 6020;
app.listen(PORT, () =>
  logger.info(`🚀 Server listening on http://localhost:${PORT}`)
);
