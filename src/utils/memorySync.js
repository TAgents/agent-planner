const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function computeHash(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function scanMemoryFiles(dir) {
  try {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.md'))
      .map(name => ({
        name,
        content: fs.readFileSync(path.join(dir, name), 'utf-8'),
      }));
  } catch {
    return [];
  }
}

module.exports = { computeHash, scanMemoryFiles };
