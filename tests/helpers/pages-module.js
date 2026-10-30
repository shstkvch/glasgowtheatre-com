const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { DatabaseSync } = require('node:sqlite');
const root = path.resolve(__dirname, '../..');
const urls = new Map();
function moduleUrl(file) {
  if (urls.has(file)) return urls.get(file);
  let source = fs.readFileSync(file, 'utf8');
  if (!/^export |^import /m.test(source)) return pathToFileURL(file).href;
  source = source.replace(/from (['"])(\.[^'"]+)\1/g, (match, quote, relative) => 'from ' + JSON.stringify(moduleUrl(path.resolve(path.dirname(file), relative))));
  const url = 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
  urls.set(file, url); return url;
}
exports.load = relative => import(moduleUrl(path.join(root, relative)));
exports.database = () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(fs.readFileSync(path.join(root, 'db/schema.sql'), 'utf8'));
  const db = {
    prepare(sql) {
      let params = [];
      const execute = () => /^\s*SELECT/i.test(sql) ? { results: sqlite.prepare(sql).all(...params) } : { success: true, meta: { changes: Number(sqlite.prepare(sql).run(...params).changes) } };
      return { bind(...values) { params = values; return this; }, async first() { return sqlite.prepare(sql).get(...params) || null; }, async run() { return execute(); }, execute };
    },
    async batch(statements) { sqlite.exec('BEGIN'); try { const rows = statements.map(statement => statement.execute()); sqlite.exec('COMMIT'); return rows; } catch (error) { sqlite.exec('ROLLBACK'); throw error; } },
  };
  return { db, sqlite };
};
