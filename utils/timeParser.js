/**
 * Parse time string like '10m', '2h', '1d', '7d', '30d' into milliseconds
 * @param {string} str
 * @returns {number|null} milliseconds or null if permanent / invalid
 */
function parseDuration(str) {
  if (!str) return null;
  const s = str.trim().toLowerCase();
  if (['perm', 'permanent', '0', 'навсегда', 'вечно'].includes(s)) {
    return null;
  }

  const regex = /^(\d+)\s*(s|m|h|d|w|y|сек|мин|ч|дн|д|нед|г)$/i;
  const match = s.match(regex);
  if (!match) return null;

  const count = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case 's':
    case 'сек':
      return count * 1000;
    case 'm':
    case 'мин':
      return count * 60 * 1000;
    case 'h':
    case 'ч':
      return count * 60 * 60 * 1000;
    case 'd':
    case 'д':
    case 'дн':
      return count * 24 * 60 * 60 * 1000;
    case 'w':
    case 'нед':
      return count * 7 * 24 * 60 * 60 * 1000;
    case 'y':
    case 'г':
      return count * 365 * 24 * 60 * 60 * 1000;
    default:
      return null;
  }
}

/**
 * Format duration ms into human readable string in Russian
 * @param {number} ms
 * @returns {string}
 */
function formatDurationRu(ms) {
  if (!ms || ms <= 0) return 'Навсегда';
  const seconds = Math.floor((ms / 1000) % 60);
  const minutes = Math.floor((ms / (1000 * 60)) % 60);
  const hours = Math.floor((ms / (1000 * 60 * 60)) % 24);
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));

  const parts = [];
  if (days > 0) parts.push(`${days} дн.`);
  if (hours > 0) parts.push(`${hours} ч.`);
  if (minutes > 0) parts.push(`${minutes} мин.`);
  if (seconds > 0 && parts.length === 0) parts.push(`${seconds} сек.`);

  return parts.join(' ') || 'Меньше минуты';
}

/**
 * Format timestamp into readable date
 */
function formatTimestamp(timestamp) {
  if (!timestamp) return '—';
  const date = new Date(timestamp);
  return date.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
}

/**
 * Format seconds into readable time (hours, minutes, seconds)
 */
function formatSecondsToTime(totalSeconds) {
  if (!totalSeconds || totalSeconds <= 0) return '0 мин.';
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);

  const parts = [];
  if (hours > 0) parts.push(`${hours} ч.`);
  if (minutes > 0) parts.push(`${minutes} мин.`);
  if (seconds > 0 && hours === 0) parts.push(`${seconds} сек.`);

  return parts.join(' ') || '0 мин.';
}

module.exports = {
  parseDuration,
  formatDurationRu,
  formatTimestamp,
  formatSecondsToTime
};
