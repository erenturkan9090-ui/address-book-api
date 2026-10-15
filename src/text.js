'use strict';

/**
 * Lower-cases and strips diacritics so "isik" finds "Işık" and "ayse" finds
 * "AYŞE". The Turkish locale is used for lower-casing because "I" and "İ"
 * map to different letters there; dotless "ı" is folded to "i" afterwards.
 */
function fold(text) {
  return String(text)
    .toLocaleLowerCase('tr')
    .replace(/ı/g, 'i')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

module.exports = { fold };
