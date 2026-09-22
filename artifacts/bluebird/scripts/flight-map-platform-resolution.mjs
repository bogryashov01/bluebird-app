import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '..');
const outputRoot = mkdtempSync(path.join(tmpdir(), 'bluebird-flight-map-'));

function filesWithExtension(directory, extension) {
  const matches = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      matches.push(...filesWithExtension(entryPath, extension));
    } else if (entry.name.endsWith(extension)) {
      matches.push(entryPath);
    }
  }
  return matches;
}

function exportPlatform(platform) {
  const outputDirectory = path.join(outputRoot, platform);
  try {
    execFileSync(
      'pnpm',
      [
        'exec',
        'expo',
        'export',
        '--platform',
        platform,
        '--output-dir',
        outputDirectory,
        '--no-bytecode',
        '--no-minify',
        '--source-maps',
      ],
      {
        cwd: projectRoot,
        env: { ...process.env, CI: '1' },
        stdio: 'inherit',
      },
    );
  } catch (error) {
    throw new Error(`Expo ${platform} export failed`, { cause: error });
  }

  const bundles = filesWithExtension(outputDirectory, '.js');
  const sourceMaps = filesWithExtension(outputDirectory, '.map');
  if (bundles.length === 0 || sourceMaps.length === 0) {
    throw new Error(`Expo ${platform} export did not produce a bundle and source map`);
  }

  return {
    bundle: bundles.map((file) => readFileSync(file, 'utf8')).join('\n'),
    sources: sourceMaps.flatMap((file) => {
      const map = JSON.parse(readFileSync(file, 'utf8'));
      return map.sources ?? [];
    }),
  };
}

function assertIncludes(value, expected, description) {
  if (!value.includes(expected)) {
    throw new Error(`${description}: missing ${expected}`);
  }
}

function assertExcludes(value, unexpected, description) {
  if (value.includes(unexpected)) {
    throw new Error(`${description}: found ${unexpected}`);
  }
}

function assertNativeResolution(platform, result) {
  assertIncludes(
    result.sources.join('\n'),
    'FlightMap.native.tsx',
    `${platform} source-map resolution`,
  );
  assertExcludes(
    result.sources.join('\n'),
    'FlightMap.web.tsx',
    `${platform} source-map resolution`,
  );
  assertExcludes(result.bundle.toLowerCase(), 'leaflet', `${platform} bundle isolation`);
  assertExcludes(result.bundle, 'cartocdn.com', `${platform} bundle isolation`);
}

try {
  const ios = exportPlatform('ios');
  const android = exportPlatform('android');
  const web = exportPlatform('web');

  assertNativeResolution('iOS', ios);
  assertNativeResolution('Android', android);

  assertIncludes(
    web.sources.join('\n'),
    'FlightMap.web.tsx',
    'web source-map resolution',
  );
  assertExcludes(
    web.sources.join('\n'),
    'FlightMap.native.tsx',
    'web source-map resolution',
  );
  assertIncludes(web.bundle, 'cartocdn.com', 'web Leaflet map bundle');

  console.log('FlightMap platform resolution passed for iOS and web.');
} finally {
  rmSync(outputRoot, { recursive: true, force: true });
}