const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
process.chdir(root);
const test = process.argv.includes('--test');
const output = path.join(root, '.wrangler', test ? 'sponsorship-test-dist' : 'sponsorship-dist');
const persistence = path.join(root, '.wrangler', test ? 'sponsorship-test-state' : 'state');
const wrangler = path.join(root, 'node_modules/wrangler/bin/wrangler.js');
const run = (file, args, env = process.env) => {
  const result = spawnSync(process.execPath, [file, ...args], { cwd: root, env, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
};
const localVars = fs.existsSync('.dev.vars') ? fs.readFileSync('.dev.vars', 'utf8') : '';
if (!/^SPONSOR_ADMIN_PASSWORD=/m.test(localVars)) fs.writeFileSync('.dev.vars', localVars + `\nSPONSOR_ADMIN_PASSWORD=${crypto.randomBytes(24).toString('base64url')}\n`, { mode: 0o600 });
fs.chmodSync('.dev.vars', 0o600);
run(path.join(root, 'build.js'), [], { ...process.env, BUILD_OUTPUT: output });
run(wrangler, ['d1', 'execute', 'DB', '--local', '--persist-to', persistence, '--file', 'db/schema.sql']);
if (test) {
  const feed = require('../tests/fixtures/theatre-118-sponsorship.json');
  const seed = path.join(root, '.wrangler', 'sponsorship-test-seed.sql');
  const defaults = JSON.stringify(require('../src/js/sponsor-core').DEFAULTS).replace(/'/g, "''");
  fs.writeFileSync(seed, `UPDATE sponsorship_settings SET settings='${defaults}', revision=0 WHERE id='theatre-118';\nDELETE FROM admin_login_attempts;\nINSERT INTO sponsorship_feed_cache (id,feed,fetched_at) VALUES ('theatre-118','${JSON.stringify(feed).replace(/'/g, "''")}',${Date.now()}) ON CONFLICT(id) DO UPDATE SET feed=excluded.feed,etag=NULL,fetched_at=excluded.fetched_at;\n`);
  run(wrangler, ['d1', 'execute', 'DB', '--local', '--persist-to', persistence, '--file', seed]);
}
console.log(`Admin password is in the ignored .dev.vars file. Local database only.`);
const child = spawn(process.execPath, [wrangler, 'pages', 'dev', output, '--persist-to', persistence, '--port', test ? '4191' : '4190', '--inspector-port', '0', '--ip', '127.0.0.1'], { cwd: root, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', code => process.exit(code || 0));
