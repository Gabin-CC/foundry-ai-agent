// Release metadata and tracked-file checks, independent of any live services.
const excludedEnvFiles = new Set([".env.example"]);

export function isSensitiveTrackedPath(path) {
  const name = path.split("/").at(-1);
  if (path.split("/").includes(".state")) return true;
  if (name === ".env" || (name.startsWith(".env.") && !excludedEnvFiles.has(name))) return true;
  if (name === ".or_key") return true;
  return /\.(?:pem|key|p12|pfx)$/i.test(name);
}

export function validateRelease({ version, lockVersion, changelog, notes, trackedPaths = [] }) {
  const problems = [];
  if (!/^\d+\.\d+\.\d+$/.test(version)) problems.push("package.json version must use major.minor.patch");
  if (version !== lockVersion) problems.push("package.json and package-lock.json versions disagree");
  if (!changelog.includes(`## [${version}]`)) problems.push(`CHANGELOG.md is missing version ${version}`);
  if (!notes.startsWith(`# Foundry AI Agent v${version}`)) problems.push(`release notes title does not match v${version}`);

  const sensitive = trackedPaths.filter(isSensitiveTrackedPath);
  if (sensitive.length) problems.push(`sensitive paths are tracked: ${sensitive.join(", ")}`);

  return problems;
}
