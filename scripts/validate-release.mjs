#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

const tag = process.env.GITHUB_REF_NAME ?? process.argv[2] ?? '';
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const normalizedTag = tag.replace(/^v/, '');
if (!tag || normalizedTag !== version) {
  throw new Error(`release tag ${tag || '<missing>'} must match package version ${version}`);
}
if (!/^\d+\.\d+\.\d+-(alpha|beta)\.\d+$/.test(version)) {
  throw new Error(`release workflow requires a numbered alpha/beta version; package version is ${version}`);
}
console.log(`Validated prerelease v${version}`);
