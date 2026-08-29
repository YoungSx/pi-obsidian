import { readFileSync, writeFileSync } from "fs";
import process from "node:process";

// The git tag is the single source of truth for a release. This stamps the
// tag's version into the version-bearing files at release time, so no version
// number is ever hand-edited (the retired `npm version` + version-bump.mjs
// flow required editing files before tagging; a mistyped one broke the gate).
const raw = process.argv[2] ?? process.env.RELEASE_TAG;
if (!raw) {
	console.error("Usage: node scripts/stamp-version.mjs <tag>   (or set RELEASE_TAG)");
	process.exit(1);
}
const version = raw.replace(/^v/, "");
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
	console.error(`Tag "${raw}" does not yield a valid version: "${version}"`);
	process.exit(1);
}

// manifest.json is what Obsidian reads; its version must equal the release tag.
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
if (manifest.version !== version) {
	manifest.version = version;
	writeFileSync("manifest.json", JSON.stringify(manifest, null, "\t"));
}

// versions.json is the community-plugin compatibility map: release version ->
// minimum Obsidian version it supports.
const versions = JSON.parse(readFileSync("versions.json", "utf8"));
if (!Object.prototype.hasOwnProperty.call(versions, version)) {
	versions[version] = manifest.minAppVersion;
	writeFileSync("versions.json", JSON.stringify(versions, null, "\t"));
}

// package.json is not shipped, but stamped so the repo never carries a stale
// version that contradicts the latest tag.
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
if (pkg.version !== version) {
	pkg.version = version;
	writeFileSync("package.json", JSON.stringify(pkg, null, "\t") + "\n");
}

console.log(`Stamped ${version} into manifest.json, versions.json and package.json`);
