// Read-only Foundry connection check. No ChatMessage or other documents are created.
export async function checkFoundryConnection({ login, username, password, adminPassword = "" }) {
  const session = await login(username, password, { adminPassword });
  if (!session) throw new Error(`Foundry login failed for account "${username}"`);

  try {
    if (!session.userId) throw new Error("Foundry login returned no user ID");

    const users = await session.doc("get", "User", { query: {} });
    if (!Array.isArray(users)) throw new Error("Foundry User query did not return a list");

    const chat = await session.doc("get", "ChatMessage", { query: {} });
    if (!Array.isArray(chat)) throw new Error("Foundry ChatMessage query did not return a list");

    return { userCount: users.length, messageCount: chat.length };
  } finally {
    await session.close?.();
  }
}
