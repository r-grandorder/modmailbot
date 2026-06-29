const { createSlashCommandManager } = require("../slashCommandManager");

/**
 * Slash command surface for staff. This lives alongside the existing text command modules
 * (reply.js, close.js, ...) rather than modifying them: those keep registering their text commands
 * (now dormant without the message content intent) and this adds the slash equivalents on top,
 * calling the same data layer. Each domain has its own registrar under src/slashCommands/, mirroring
 * the matching src/modules/*.js. The only upstream files touched are bot.js (intents) and main.js.
 */
const registrars = [
  require("../slashCommands/reply"),
  require("../slashCommands/close"),
  require("../slashCommands/block"),
  require("../slashCommands/logs"),
  require("../slashCommands/notes"),
  require("../slashCommands/roles"),
  require("../slashCommands/suspend"),
  require("../slashCommands/move"),
  require("../slashCommands/alert"),
  require("../slashCommands/id"),
  require("../slashCommands/newthread"),
  require("../slashCommands/version"),
  require("../slashCommands/snippets"),
];

module.exports = (pluginApi) => {
  const slash = createSlashCommandManager(pluginApi.bot);

  for (const register of registrars) {
    register(slash, pluginApi);
  }

  registerSlashCommands(slash);
};

async function registerSlashCommands(slash) {
  try {
    await slash.registerCommands();
    console.log(`Registered ${slash.buildPayload().length} slash commands`);
  } catch (err) {
    if (err && (err.code === 50001 || (err.message && err.message.includes("Missing Access")))) {
      console.error(
        "[ERROR] Failed to register slash commands: the bot is missing the 'applications.commands' scope. " +
        "Re-invite it with that scope enabled."
      );
    } else {
      console.error(`[ERROR] Failed to register slash commands: ${err && err.message}`);
    }
  }
}
