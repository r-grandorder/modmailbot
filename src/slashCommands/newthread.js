const threads = require("../data/threads");
const { ApplicationCommandOptionTypes: OPT } = require("eris").Constants;

// Slash equivalent of src/modules/newthread.js
module.exports = (slash, { bot }) => {
  slash.addInboxCommand({
    name: "newthread",
    description: "Open a new modmail thread with a user",
    options: [{ type: OPT.USER, name: "user", description: "User to open a thread with", required: true }],
    handler: async (ctx, args) => {
      const userId = args.user.id;
      const user = bot.users.get(userId) || await bot.getRESTUser(userId).catch(() => null);
      if (! user) return ctx.respond("User not found.");
      if (user.bot) return ctx.respond("Can't open a thread with a bot.");

      const existingThread = await threads.findOpenThreadByUserId(user.id);
      if (existingThread) return ctx.respond(`There is already an open thread with this user: <#${existingThread.channel_id}>`);

      const createdThread = await threads.createNewThreadForUser(user, {
        quiet: true,
        ignoreRequirements: true,
        ignoreHooks: true,
        source: "command",
      });
      await createdThread.postSystemMessage(`Thread was opened by ${ctx.author.globalName || ctx.author.username}`);
      return ctx.respond(`Thread opened: <#${createdThread.channel_id}>`, { persist: true });
    },
  });
};
