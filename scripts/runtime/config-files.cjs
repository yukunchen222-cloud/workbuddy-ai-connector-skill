'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
function writeJson(file, value) {
  const temporary = file + '.' + crypto.randomUUID() + '.tmp';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { flag: 'wx' });
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}
function writeConfigurations(entries, backupRoot, write = writeJson) {
  const originals = entries.map(([file]) => fs.existsSync(file) ? fs.readFileSync(file) : null);
  fs.mkdirSync(backupRoot, { recursive: true });
  entries.forEach(([file], index) => {
    if (originals[index] !== null) fs.writeFileSync(path.join(backupRoot, path.basename(file)), originals[index], { flag: 'wx' });
  });
  let completed = 0;
  try {
    for (const [file, value] of entries) { write(file, value); completed++; }
  } catch (error) {
    for (let index = completed - 1; index >= 0; index--) {
      if (originals[index] === null) fs.unlinkSync(entries[index][0]);
      else fs.writeFileSync(entries[index][0], originals[index]);
    }
    throw error;
  }
}
module.exports = { writeJson, writeConfigurations };
