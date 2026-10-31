import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const projectRoot = resolve(import.meta.dirname, '..');
const envFile = resolve(projectRoot, '../../.env');

const required = [
  'EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_BASE_URL',
  'EXPO_PUBLIC_BLUEBIRD_PRODUCTION_CLERK_PUBLISHABLE_KEY',
  'EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_CLERK_ISSUER',
  'EXPO_PUBLIC_ENABLE_PRODUCTION_CLERK_AUTH',
];

const omittedFromMetro = [
  'EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY',
  'EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_CLERK_PUBLISHABLE_KEY',
  'EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_API_CLERK_ISSUER',
  'EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_API_BASE_URL',
  'EXPO_PUBLIC_DOMAIN',
];

const liveFlags = {
  EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT: 'production',
  EXPO_PUBLIC_BLUEBIRD_NATIVE_AUTH_TEST: 'false',
  EXPO_PUBLIC_BLUEBIRD_PRODUCTION_QUEUE_MUTATIONS: 'true',
  EXPO_PUBLIC_ENABLE_CLERK_AUTH: 'false',
  EXPO_PUBLIC_ENABLE_PRODUCTION_CLERK_AUTH: 'true',
  EXPO_PUBLIC_BLUEBIRD_FULL_APP_DEMO: 'false',
  EXPO_PUBLIC_BLUEBIRD_PRODUCTION_CLERK_DEBUG: 'true',
  EXPO_PUBLIC_BLUEBIRD_FLIGHT_READ_MODE: 'production',
  EXPO_PUBLIC_BLUEBIRD_MEMBERSHIP_DATA_MODE: 'production',
  EXPO_PUBLIC_BLUEBIRD_MEMBER_CONNECTIONS: 'false',
  EXPO_PUBLIC_BLUEBIRD_MEMBER_MESSAGES: 'false',
};

function loadEnvFile(path) {
  const text = readFileSync(path, 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const separator = trimmed.indexOf('=');
    const name = trimmed.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[name] = value;
  }
}

function clerkHost(value) {
  if (typeof value !== 'string' || !value.startsWith('pk_live_')) return null;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let bits = 0;
  let accumulator = 0;
  let decoded = '';
  for (const character of value.slice('pk_live_'.length)) {
    const code = character === '-' ? 62 : character === '_' ? 63 : alphabet.indexOf(character);
    if (code < 0) return null;
    accumulator = (accumulator << 6) | code;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      decoded += String.fromCharCode((accumulator >> bits) & 0xff);
    }
  }
  const host = decoded.replace(/\$$/, '').trim().toLowerCase();
  if (!host || !/^[a-z0-9.-]+$/.test(host) || host.startsWith('.') || host.endsWith('.') || host.includes('..')) {
    return null;
  }
  return host;
}

function issuerHost(value) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) return null;
    if (parsed.pathname !== '/' && parsed.pathname !== '') return null;
    return parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function startLiveMetro(overrides = {}, options = {}) {
  loadEnvFile(envFile);
  const flags = { ...liveFlags, ...overrides };
  for (const [name, value] of Object.entries(flags)) process.env[name] = value;
  for (const name of omittedFromMetro) delete process.env[name];

  const apiUrl = process.env.EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_BASE_URL ?? '';
  const key = process.env.EXPO_PUBLIC_BLUEBIRD_PRODUCTION_CLERK_PUBLISHABLE_KEY ?? '';
  const issuer = process.env.EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_CLERK_ISSUER ?? '';
  let apiHost = null;
  let apiPath = null;
  try {
    const parsed = new URL(apiUrl);
    apiHost = parsed.hostname.toLowerCase();
    apiPath = parsed.pathname.replace(/\/+$/, '');
  } catch {
    apiHost = null;
  }
  const keyHost = clerkHost(key);
  const configuredIssuerHost = issuerHost(issuer);
  const variableStatus = Object.fromEntries(
    required.map((name) => [name, process.env[name]?.trim() ? 'present' : 'missing']),
  );
  const report = {
    scope: options.scope ?? 'Local Metro only. Values are not printed.',
    apiEnvironment: flags.EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT,
    apiHost,
    apiPath,
    clerkKeyPrefix: key.startsWith('pk_live_') ? 'pk_live' : key.startsWith('pk_test_') ? 'pk_test' : 'invalid',
    clerkHost: keyHost,
    issuerHost: configuredIssuerHost,
    clerkHostMatchesIssuer: keyHost !== null && keyHost === configuredIssuerHost,
    developmentPublishableKey: 'omitted',
    legacyPublishableKey: 'omitted',
    nativeAuthTest: flags.EXPO_PUBLIC_BLUEBIRD_NATIVE_AUTH_TEST,
    queueMutations: flags.EXPO_PUBLIC_BLUEBIRD_PRODUCTION_QUEUE_MUTATIONS,
    fullAppDemo: flags.EXPO_PUBLIC_BLUEBIRD_FULL_APP_DEMO,
    productionClerkDebug: flags.EXPO_PUBLIC_BLUEBIRD_PRODUCTION_CLERK_DEBUG,
    flightReadMode: flags.EXPO_PUBLIC_BLUEBIRD_FLIGHT_READ_MODE,
    membershipDataMode: flags.EXPO_PUBLIC_BLUEBIRD_MEMBERSHIP_DATA_MODE,
    connections: flags.EXPO_PUBLIC_BLUEBIRD_MEMBER_CONNECTIONS,
    messages: flags.EXPO_PUBLIC_BLUEBIRD_MEMBER_MESSAGES,
    legacyDomain: 'omitted',
    requiredProductionVariables: variableStatus,
  };
  console.log(JSON.stringify(report, null, 2));

  const missing = Object.entries(variableStatus)
    .filter(([, status]) => status === 'missing')
    .map(([name]) => name);
  const configurationReady = missing.length === 0 &&
    report.clerkKeyPrefix === 'pk_live' &&
    report.clerkHostMatchesIssuer &&
    apiHost === 'bluebirdjets.com' &&
    apiPath === '/api' &&
    process.env.EXPO_PUBLIC_ENABLE_PRODUCTION_CLERK_AUTH === 'true';
  if (!configurationReady) {
    console.error(missing.length > 0
      ? `Missing production configuration: ${missing.join(', ')}`
      : 'Production Clerk configuration does not match the production API.');
    process.exit(1);
  }
  if (options.checkOnly || process.argv.includes('--check')) return;

  const hostArgs = process.env.BLUEBIRD_EXPO_TUNNEL === 'true' ? ['--tunnel'] : ['--host', 'lan'];
  const child = spawn(
    'pnpm',
    ['exec', 'expo', 'start', '--dev-client', '--clear', ...hostArgs],
    { cwd: projectRoot, stdio: 'inherit', env: process.env },
  );
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 1);
  });
}
