'use strict';
// Creates a self-signed HTTPS certificate in config/certs/.
// Tries OpenSSL (on PATH, or the copies bundled with Git for Windows), then falls
// back to the pure-JavaScript "selfsigned" package (installed by npm install).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { paths, APP_NAME } = require('../server/config');

const lanAddresses = () => Object.values(os.networkInterfaces()).flat()
  .filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);

function names(address) {
  const isIp = (s) => /^\d+\.\d+\.\d+\.\d+$/.test(s);
  const dns = [...new Set([address, 'localhost', os.hostname()].filter((s) => s && !isIp(s)))];
  const ips = [...new Set([address, '127.0.0.1', ...lanAddresses()].filter(isIp))];
  return { dns, ips };
}

function opensslCandidates() {
  const list = ['openssl'];
  if (process.platform === 'win32') {
    const pf = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')].filter(Boolean);
    for (const base of pf) {
      list.push(path.join(base, 'Git', 'usr', 'bin', 'openssl.exe'), path.join(base, 'Git', 'mingw64', 'bin', 'openssl.exe'),
        path.join(base, 'OpenSSL-Win64', 'bin', 'openssl.exe'), path.join(base, 'OpenSSL', 'bin', 'openssl.exe'));
    }
  }
  return list;
}

function tryOpenssl(address, keyFile, certFile) {
  const { dns, ips } = names(address);
  const san = [...dns.map((d) => `DNS:${d}`), ...ips.map((i) => `IP:${i}`)].join(',');
  for (const bin of opensslCandidates()) {
    if (bin !== 'openssl' && !fs.existsSync(bin)) continue;
    const r = spawnSync(bin, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-keyout', keyFile, '-out', certFile, '-days', '825',
      '-subj', `/CN=${address}`, '-addext', `subjectAltName=${san}`], { stdio: 'pipe', env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
    if (!r.error && r.status === 0 && fs.existsSync(certFile)) return 'OpenSSL';
  }
  return null;
}

async function trySelfsigned(address, keyFile, certFile) {
  let selfsigned;
  try { selfsigned = require('selfsigned'); } catch (_) { return null; }
  const { dns, ips } = names(address);
  const r = await selfsigned.generate([{ name: 'commonName', value: address }, { name: 'organizationName', value: APP_NAME.replace(/'/g, '') }], {
    days: 825, keySize: 2048, algorithm: 'sha256',
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectAltName', altNames: [...dns.map((value) => ({ type: 2, value })), ...ips.map((ip) => ({ type: 7, ip }))] },
    ],
  });
  fs.writeFileSync(keyFile, r.private);
  fs.writeFileSync(certFile, r.cert);
  return 'the built-in generator';
}

async function generateCert(address) {
  fs.mkdirSync(paths.CERTS, { recursive: true });
  const keyFile = path.join(paths.CERTS, 'key.pem');
  const certFile = path.join(paths.CERTS, 'cert.pem');
  const how = tryOpenssl(address, keyFile, certFile) || await trySelfsigned(address, keyFile, certFile);
  if (!how) return null;
  return { certFile: 'config/certs/cert.pem', keyFile: 'config/certs/key.pem', how };
}

module.exports = { generateCert, lanAddresses };
