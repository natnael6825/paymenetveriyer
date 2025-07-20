// src/services/cbeVerifier.js
const axios = require('axios');
const pdf = require('pdf-parse');
const https = require('https');
const puppeteer = require('puppeteer');
const logger = require('../utils/logger');

/** Turn “foo BAR” → “Foo Bar” **/
function titleCase(str) {
  return str
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase());
}

/** Parse the PDF buffer into structured fields **/
async function parseCBEReceipt(buffer) {
  try {
    const parsed = await pdf(Buffer.from(buffer));
    const raw = parsed.text.replace(/\s+/g, ' ').trim();

    let payer    = raw.match(/Payer\s*:?\s*(.*?)\s+Account/i)?.[1]?.trim();
    let receiver = raw.match(/Receiver\s*:?\s*(.*?)\s+Account/i)?.[1]?.trim();
    const accounts = [...raw.matchAll(/Account\s*:?\s*([A-Z0-9]?\*{4}\d{4})/gi)];
    const payerAcct    = accounts[0]?.[1];
    const receiverAcct = accounts[1]?.[1];
    const reason = raw.match(/Reason\s*\/\s*Type of service\s*:?\s*(.*?)\s+Transferred Amount/i)?.[1]?.trim();
    const amtTxt = raw.match(/Transferred Amount\s*:?\s*([\d,]+\.\d{2})\s*ETB/i)?.[1];
    const ref    = raw.match(/Reference No\.?\s*\(VAT Invoice No\)\s*:?\s*([A-Z0-9]+)/i)?.[1]?.trim();
    const dateRaw= raw.match(/Payment Date & Time\s*:?\s*([\d\/,: ]+[APM]{2})/i)?.[1]?.trim();

    const amount = amtTxt ? parseFloat(amtTxt.replace(/,/g, '')) : undefined;
    const date   = dateRaw ? new Date(dateRaw) : undefined;

    if (payer)    payer    = titleCase(payer);
    if (receiver) receiver = titleCase(receiver);

    if (payer && payerAcct && receiver && receiverAcct && amount != null && date && ref) {
      return {
        success: true,
        status: 'paid',
        payer,
        payerAccount:    payerAcct,
        receiver,
        receiverAccount: receiverAcct,
        amount,
        date,
        reference: ref,
        reason: reason || null
      };
    }
    return { success: false, status: 'unpaid', error: 'Incomplete PDF fields' };
  } catch (e) {
    logger.error('PDF parse error:', e);
    return { success: false, status: 'unpaid', error: 'PDF parse failed' };
  }
}

/**
 * verifyCBE(reference: string)
 * Treats `reference` as the full CBE ID.
 */
async function verifyCBE(reference) {
  const url = `https://apps.cbe.com.et:100/?id=${reference}`;
  const httpsAgent = new https.Agent({ rejectUnauthorized: false });

  // 1) Try direct PDF fetch
  try {
    logger.info(`🔎 CBE direct PDF fetch: ${url}`);
    const resp = await axios.get(url, {
      httpsAgent,
      responseType: 'arraybuffer',
      headers: { 'User-Agent':'Mozilla/5.0', 'Accept':'application/pdf' },
      timeout: 30000
    });
    return await parseCBEReceipt(resp.data);
  } catch (_) {
    logger.warn('CBE direct failed, falling back to Puppeteer');
  }

  // 2) Fallback via Puppeteer
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox','--disable-setuid-sandbox','--ignore-certificate-errors'],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
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
    const pdfResp = await axios.get(pdfUrl, {
      httpsAgent,
      responseType: 'arraybuffer'
    });
    return await parseCBEReceipt(pdfResp.data);
  } catch (e) {
    logger.error('CBE Puppeteer fallback failed:', e);
    if (browser) await browser.close();
    return { success: false, status: 'unpaid', error: e.message };
  }
}

module.exports = { verifyCBE };
