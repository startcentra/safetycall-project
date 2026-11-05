#!/usr/bin/env node
// Offline read-only dependency tree inventory: NO npm subprocess/network or code execution.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const lock=JSON.parse(readFileSync(new URL('../package-lock.json',import.meta.url),'utf8'));
assert.equal(lock.lockfileVersion,3,'Expected npm lockfile v3');
const pkgs=lock.packages||{};
const minimatches=Object.entries(pkgs).filter(([path])=>path==='node_modules/minimatch'||path.endsWith('/node_modules/minimatch')).map(([path,p])=>({path,version:p.version,integrity:!!p.integrity,resolved:p.resolved||null}));
const parents=Object.entries(pkgs).filter(([,p])=>p.dependencies?.minimatch).map(([path,p])=>({path,version:p.version,range:p.dependencies.minimatch}));
const badHosts=Object.entries(pkgs).filter(([,p])=>p.resolved&&!p.resolved.startsWith('https://registry.npmjs.org/')).map(([path,p])=>({path,resolved:p.resolved}));
console.log(JSON.stringify({packageCount:Object.keys(pkgs).length,minimatches,parents,untrustedPackageSources:badHosts},null,2));
if(badHosts.length)process.exitCode=1;
