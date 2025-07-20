const axios = require('axios');
const pdf = require('pdf-parse');
const https = require('https');
const puppeteer = require('puppeteer');
const logger = require('../utils/logger');

/**
 * @param {string} str
 * @returns {string}
 */
function titleCase(str) {
  return str
    .toLowerCase()
    .replace(/\b\w/g, char => char.toUpperCase());
}

/**
 * @param {Buffer|ArrayBuffer} buffer
 */
async function parseCBEReceipt(buffer) {
  try {
    const parsed = await pdf(Buffer.from(buffer));
    const rawText = parsed.text.replace(/\s+/g, ' ').trim();

    let payerName    = rawText.match(/Payer\s*:?\s*(.*?)\s+Account/i)?.[1]?.trim();
    let receiverName = rawText.match(/Receiver\s*:?\s*(.*?)\s+Account/i)?.[1]?.trim();
    const accounts   = [...rawText.matchAll(/Account\s*:?\s*([A-Z0-9]?\*{4}\d{4})/gi)];
    const payerAccount    = accounts[0]?.[1];
    const receiverAccount = accounts[1]?.[1];
    const reason     = rawText.match(/Reason\s*\/\s*Type of service\s*:?\s*(.*?)\s+Transferred Amount/i)?.[1]?.trim();
    const amountText = rawText.match(/Transferred Amount\s*:?\s*([\d,]+\.\d{2})\s*ETB/i)?.[1];
    const reference  = rawText.match(/Reference No\.?\s*\(VAT Invoice No\)\s*:?\s*([A-Z0-9]+)/i)?.[1]?.trim();
    const dateRaw    = rawText.match(/Payment Date & Time\s*:?\s*([\d\/,: ]+[APM]{2})/i)?.[1]?.trim();

    const amount = amountText ? parseFloat(amountText.replace(/,/g, '')) : undefined;
    const date   = dateRaw ? new Date(dateRaw) : undefined;

    if (payerName)    payerName    = titleCase(payerName);
    if (receiverName) receiverName = titleCase(receiverName);

    if (payerName && payerAccount && receiverName && receiverAccount && amount && date && reference) {
      return {
        success: true,
        status: 'paid',
        payer: payerName,
        payerAccount,
        receiver: receiverName,
        receiverAccount,
        amount,
        date,
        reference,
        reason: reason || null
      };
    }

    return { success: false, status: 'unpaid', error: 'Incomplete fields' };
  } catch (err) {
    logger.error('PDF parse error:', err);
    return { success: false, status: 'unpaid', error: 'PDF parse error' };
  }
}

/**
 * @param {string} reference
 * @param {string} accountSuffix
 */
async function verifyCBE(reference, accountSuffix) {
  const fullId = reference + accountSuffix;
  const url = `https://apps.cbe.com.et:100/?id=${fullId}`;
  const httpsAgent = new https.Agent({ rejectUnauthorized: false });

  // try direct PDF fetch
  try {
    logger.info(`🔎 Fetching PDF directly: ${url}`);
    const resp = await axios.get(url, {
      httpsAgent,
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/pdf'
      },
      timeout: 30000
    });
    return await parseCBEReceipt(resp.data);
  } catch (e) {
    logger.warn('Direct PDF fetch failed, falling back to Puppeteer');
  }

  // fallback via Puppeteer
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--ignore-certificate-errors'
      ],
      executablePath: '/usr/bin/chromium-browser',
    });
    const page = await browser.newPage();

    let pdfUrl = null;
    page.on('response', resp => {
      if (resp.headers()['content-type']?.includes('pdf')) {
        pdfUrl = resp.url();
      }
    });

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(3000);
    await browser.close();

    if (!pdfUrl) {
      return { success: false, status: 'unpaid', error: 'No PDF detected' };
    }

    const pdfResp = await axios.get(pdfUrl, { httpsAgent, responseType: 'arraybuffer' });
    return await parseCBEReceipt(pdfResp.data);
  } catch (err) {
    logger.error('Puppeteer fallback failed:', err);
    if (browser) await browser.close();
    return { success: false, status: 'unpaid', error: err.message };
  }
}

module.exports = { verifyCBE };
