const moment = require("moment");
const humanizeDuration = require("humanize-duration");
const utils = require("../utils");
const blocked = require("../data/blocked");
const { ApplicationCommandOptionTypes: OPT } = require("eris").Constants;

// Slash equivalent of src/modules/block.js
module.exports = (slash, { bot, config }) => {
  if (! config.allowBlock) return;

  const userOption = (description) => ({ type: OPT.USER, name: "user", description, required: false });

  slash.addInboxCommand({
    name: "block",
    description: "Block a user from using modmail",
    options: [
      userOption("User to block (defaults to this thread's user)"),
      { type: OPT.STRING, name: "duration", description: "Optional duration, e.g. \"7d\"", required: false },
    ],
    handler: async (ctx, args, thread) => {
      const userId = (args.user && args.user.id) || (thread && thread.user_id);
      if (! userId) return ctx.respond("Specify a user, or run this inside a thread.");

      if (await blocked.isBlocked(userId)) return ctx.respond("That user is already blocked.");

      const blockTime = args.duration ? utils.convertDelayStringToMS(args.duration) : null;
      if (args.duration && ! blockTime) return ctx.respond("Invalid duration. Format example: \"7d\".");

      const expiresAt = blockTime
        ? moment.utc().add(blockTime, "ms").format("YYYY-MM-DD HH:mm:ss")
        : null;

      const user = (args.user && args.user.username ? args.user : bot.users.get(userId));
      await blocked.block(userId, (user ? user.username : ""), ctx.author.id, expiresAt);

      if (expiresAt) {
        const humanized = humanizeDuration(blockTime, { largest: 2, round: true });
        const timedBlockMessage = config.timedBlockMessage || config.blockMessage;
        if (timedBlockMessage && user) {
          const dmChannel = await user.getDMChannel().catch(() => null);
          if (dmChannel) {
            const formatted = timedBlockMessage
              .replace(/\{duration}/g, humanized)
              .replace(/\{timestamp}/g, moment.utc(expiresAt).format("X"));
            dmChannel.createMessage(formatted).catch(utils.noop);
          }
        }
        return ctx.respond(`Blocked <@${userId}> (\`${userId}\`) from modmail for ${humanized}.`);
      }

      if (config.blockMessage != null && user) {
        const dmChannel = await user.getDMChannel().catch(() => null);
        if (dmChannel) dmChannel.createMessage(config.blockMessage).catch(utils.noop);
      }
      return ctx.respond(`Blocked <@${userId}> (\`${userId}\`) from modmail indefinitely.`);
    },
  });

  slash.addInboxCommand({
    name: "unblock",
    description: "Unblock a user (or schedule an unblock)",
    options: [
      userOption("User to unblock (defaults to this thread's user)"),
      { type: OPT.STRING, name: "duration", description: "Optional delay before unblocking", required: false },
    ],
    handler: async (ctx, args, thread) => {
      const userId = (args.user && args.user.id) || (thread && thread.user_id);
      if (! userId) return ctx.respond("Specify a user, or run this inside a thread.");

      if (! await blocked.isBlocked(userId)) return ctx.respond("That user is not blocked.");

      const unblockDelay = args.duration ? utils.convertDelayStringToMS(args.duration) : null;
      if (args.duration && ! unblockDelay) return ctx.respond("Invalid delay. Format example: \"1d\".");

      const user = (args.user && args.user.username ? args.user : bot.users.get(userId));

      if (unblockDelay) {
        const humanized = humanizeDuration(unblockDelay, { largest: 2, round: true });
        const unblockAt = moment.utc().add(unblockDelay, "ms").format("YYYY-MM-DD HH:mm:ss");
        await blocked.updateExpiryTime(userId, unblockAt);

        const timedUnblockMessage = config.timedUnblockMessage || config.unblockMessage;
        if (timedUnblockMessage && user) {
          const dmChannel = await user.getDMChannel().catch(() => null);
          if (dmChannel) {
            const formatted = timedUnblockMessage
              .replace(/\{delay}/g, humanized)
              .replace(/\{timestamp}/g, moment.utc(unblockAt).format("X"));
            dmChannel.createMessage(formatted).catch(utils.noop);
          }
        }
        return ctx.respond(`Scheduled <@${userId}> (\`${userId}\`) to be unblocked in ${humanized}.`);
      }

      await blocked.unblock(userId);
      if (config.unblockMessage && user) {
        const dmChannel = await user.getDMChannel().catch(() => null);
        if (dmChannel) dmChannel.createMessage(config.unblockMessage).catch(utils.noop);
      }
      return ctx.respond(`Unblocked <@${userId}> (\`${userId}\`) from modmail.`);
    },
  });

  slash.addInboxCommand({
    name: "is_blocked",
    description: "Check whether a user is blocked",
    options: [{ type: OPT.USER, name: "user", description: "User to check (defaults to this thread's user)", required: false }],
    handler: async (ctx, args, thread) => {
      const userId = (args.user && args.user.id) || (thread && thread.user_id);
      if (! userId) return ctx.respond("Specify a user, or run this inside a thread.");

      const blockStatus = await blocked.getBlockStatus(userId);
      if (! blockStatus.isBlocked) return ctx.respond(`<@${userId}> (\`${userId}\`) is **not** blocked.`, { persist: true });
      if (blockStatus.expiresAt) return ctx.respond(`<@${userId}> (\`${userId}\`) is blocked until ${blockStatus.expiresAt} (UTC).`, { persist: true });
      return ctx.respond(`<@${userId}> (\`${userId}\`) is blocked indefinitely.`, { persist: true });
    },
  });

  slash.addInboxCommand({
    name: "blocklist",
    description: "List all currently blocked users",
    handler: async (ctx) => {
      const blockedUsers = await blocked.getBlockedUsers();
      if (blockedUsers.length === 0) return ctx.respond("No users are currently blocked.");

      let reply = "List of blocked users:\n";
      for (const user of blockedUsers) {
        reply += `**<@${user.userId}> (\`${user.userId}\`)** blocked by <@${user.blockedBy}>${user.expiresAt ? ` until ${user.expiresAt} (UTC)` : " permanently"}\n`;
      }
      return ctx.respond({ content: reply, allowedMentions: {} }, { persist: true });
    },
  });
};
