const axios  = require('axios');
const cheerio = require('cheerio');
const logger = require('../utils/logger');

/** Scrape the exact HTML you pasted **/
function scrapeTelebirrReceipt(html) {
  const $ = cheerio.load(html);

  // helper: find a <td> whose text starts with `label` and grab the next <td>
  const pick = label =>
    $(`td`).filter((i, el) =>
      $(el).text().trim().startsWith(label)
    ).first().next().text().trim();

  // locate the “Invoice details” table and its rows
  const invoiceTable = $('table').filter((i, tbl) =>
    $(tbl).find('td').first().text().includes('Invoice details')
  );
  const rows = invoiceTable.find('tr');

  return {
    payerName:             pick('የከፋይ ስም/Payer Name'),
    payerTelebirrNo:       pick('የከፋይ ቴሌብር ቁ./Payer telebirr no.'),
    creditedPartyName:     pick('የገንዘብ ተቀባይ ስም/Credited Party name'),
    creditedPartyAccountNo: pick('የገንዘብ ተቀባይ ቴሌብር ቁ./Credited party account no'),
    transactionStatus:     pick('የክፍያው ሁኔታ/transaction status'),
    receiptNo:             rows.eq(2).find('td').eq(0).text().trim(),
    paymentDate:           rows.eq(2).find('td').eq(1).text().trim(),
    settledAmount:         rows.eq(2).find('td').eq(2).text().trim(),
    serviceFee:            pick('የአገልግሎት ክፍያ/service fee'),
    serviceFeeVAT:         pick('የአገልግሎት ክፍያ ተ.እ.ታ/Service fee VAT'),
    totalPaidAmount:       pick('ጠቅላላ የተከፈለ/Total Paid Amount')
  };
}

/** Parse JSON fallback **/
function parseTelebirrJson(json) {
  if (!json?.success || !json.data) {
    logger.warn('Invalid Telebirr JSON:', json);
    return null;
  }
  return json.data;
}

async function fetchFromPrimarySource(ref, baseUrl) {
  try {
    logger.info(`Fetching Telebirr HTML: ${baseUrl}${ref}`);
    // ← here’s the 15s timeout you can increase:
    const resp = await axios.get(baseUrl + ref, { timeout: 15000 });
    return scrapeTelebirrReceipt(resp.data);
  } catch (e) {
    logger.error('Primary Telebirr fetch error:', e);
    return null;
  }
}

async function fetchFromProxySource(ref, proxyUrl) {
  try {
    logger.info(`Fetching Telebirr JSON proxy: ${proxyUrl}${ref}`);
    // ← and here too, if you want to give the proxy more time:
    const resp = await axios.get(proxyUrl + ref, {
      timeout: 15000,
      headers: { Accept: 'application/json', 'User-Agent': 'VerifierAPI/1.0' }
    });
    …
  } catch (e) {
    logger.error('Proxy Telebirr fetch error:', e);
    return null;
  }
}

function isValidReceipt(r) {
  return Boolean(r && r.receiptNo && r.transactionStatus);
}

/**
 * verifyTelebirr(reference: string)
 * returns TelebirrReceipt or null
 */
async function verifyTelebirr(reference) {
  const primaryUrl  = 'https://transactioninfo.ethiotelecom.et/receipt/';
  const fallbackUrl = process.env.TELEBIRR_FALLBACK_URL;

  if (process.env.SKIP_PRIMARY_VERIFICATION !== 'true') {
    const htmlRes = await fetchFromPrimarySource(reference, primaryUrl);
    if (isValidReceipt(htmlRes)) return htmlRes;
    logger.warn(`Primary Telebirr failed for ${reference}, falling back`);
  }

  const proxyRes = await fetchFromProxySource(reference, fallbackUrl);
  if (isValidReceipt(proxyRes)) {
    return proxyRes;
  }

  logger.error(`Both Telebirr methods failed for ${reference}`);
  return null;
}

module.exports = { verifyTelebirr };
