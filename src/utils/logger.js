// Simple console logger; swap in Winston or similar if you like
module.exports = {
  info:    (...args) => console.log('[INFO]', ...args),
  warn:    (...args) => console.warn('[WARN]', ...args),
  error:   (...args) => console.error('[ERROR]', ...args),
  debug:   (...args) => console.debug('[DEBUG]', ...args),
};
