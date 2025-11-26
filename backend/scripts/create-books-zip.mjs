import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, '..');
const distDir = path.join(backendRoot, 'dist');

if (!existsSync(distDir)) {
  console.error('No compiled files found. Run `npm run build` in backend/ first.');
  process.exit(1);
}

const artifactRoot = path.join(backendRoot, '.lambda', 'books');
rmSync(artifactRoot, { recursive: true, force: true });
mkdirSync(artifactRoot, { recursive: true });
cpSync(distDir, artifactRoot, { recursive: true });

const pkgPath = path.join(backendRoot, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const minimalPkg = {
  name: pkg.name,
  version: pkg.version,
  private: true,
  type: 'commonjs',
  dependencies: pkg.dependencies
};
writeFileSync(path.join(artifactRoot, 'package.json'), JSON.stringify(minimalPkg, null, 2));

const lockPath = path.join(backendRoot, 'package-lock.json');
if (existsSync(lockPath)) {
  cpSync(lockPath, path.join(artifactRoot, 'package-lock.json'));
}

const nodeModulesDir = path.join(backendRoot, 'node_modules');
if (!existsSync(nodeModulesDir)) {
  console.error('Missing backend/node_modules. Run `npm install` in backend/ first.');
  process.exit(1);
}
cpSync(nodeModulesDir, path.join(artifactRoot, 'node_modules'), { recursive: true });

const prune = spawnSync('npm', ['prune', '--omit=dev'], {
  cwd: artifactRoot,
  stdio: 'inherit'
});
if (prune.status !== 0) {
  console.error('Failed to prune dev dependencies');
  process.exit(prune.status ?? 1);
}

const zipPath = path.join(backendRoot, 'books-handler.zip');
rmSync(zipPath, { force: true });
const zip = spawnSync('zip', ['-rq', zipPath, '.'], {
  cwd: artifactRoot,
  stdio: 'inherit'
});
if (zip.status !== 0) {
  console.error('Failed to create zip archive');
  process.exit(zip.status ?? 1);
}

console.log(`Lambda artifact ready at ${zipPath}`);
