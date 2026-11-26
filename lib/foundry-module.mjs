// Use the Foundry client module, not the MCP server's executable entry point.
export const DEFAULT_FOUNDRY_MODULE = "foundry-vtt-mcp-server/src/foundry.mjs";

export function foundryModuleSpecifier(configured) {
  // Continue supporting an older .env that names only the package.
  if (!configured || configured === "foundry-vtt-mcp-server") return DEFAULT_FOUNDRY_MODULE;
  return configured;
}

export async function loadFoundrySession(configured) {
  const specifier = foundryModuleSpecifier(configured);
  let foundryModule;
  try {
    foundryModule = await import(specifier);
  } catch (error) {
    throw new Error(`Cannot load Foundry client module "${specifier}": ${error.message}`, { cause: error });
  }
  if (typeof foundryModule.FoundrySession?.login !== "function") {
    throw new Error(`Module "${specifier}" does not export a FoundrySession.login function`);
  }
  return foundryModule.FoundrySession;
}
