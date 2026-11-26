import { loadFoundrySession } from "../lib/foundry-module.mjs";
import { checkFoundryConnection } from "../lib/smoke-check.mjs";

const username = process.env.AI_USER || "AI";
const password = process.env.AI_PASSWORD || "";

if (!password || password === "change-me") {
  console.error("[smoke] Configure AI_PASSWORD in .env before testing Foundry.");
  process.exitCode = 1;
} else {
  try {
    const FoundrySession = await loadFoundrySession(process.env.FOUNDRY_MCP_MODULE);
    const result = await checkFoundryConnection({
      login: FoundrySession.login.bind(FoundrySession),
      username,
      password,
      adminPassword: process.env.ADMIN_PASSWORD || ""
    });
    console.log(`[smoke] Connected and read ${result.userCount} users, ${result.messageCount} chat messages.`);
    console.log("[smoke] PASS (read-only; OpenCode/MCP model interaction not tested)");
  } catch (error) {
    console.error(`[smoke] FAIL: ${error.message}`);
    process.exitCode = 1;
  }
}
