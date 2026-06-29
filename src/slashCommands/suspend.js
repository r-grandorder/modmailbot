const moment = require("moment");
const utils = require("../utils");
const threads = require("../data/threads");
const { THREAD_STATUS } = require("../data/constants");
const { ApplicationCommandOptionTypes: OPT } = require("eris").Constants;

// Slash equivalent of src/modules/suspend.js
module.exports = (slash, { config }) => {
  if (! config.allowSuspend) return;

  slash.addThreadCommand({
    name: "suspend",
    description: "Suspend this thread (acts closed until unsuspended)",
    allowSuspended: true,
    options: [
      { type: OPT.STRING, name: "time", description: "Suspend after a delay, e.g. \"2h\"", required: false },
      { type: OPT.BOOLEAN, name: "cancel", description: "Cancel a scheduled suspension", required: false },
    ],
    handler: async (ctx, args, thread) => {
      if (args.cancel) {
        if (thread.scheduled_suspend_at) {
          await thread.cancelScheduledSuspend();
          const cancelledBy = config.useDisplaynames ? (ctx.author.globalName || ctx.author.username) : ctx.author.username;
          // Public so other staff who saw the scheduled-suspend notice know it is no longer pending.
          await thread.postSystemMessage(`Scheduled suspension cancelled by ${cancelledBy}.`);
          return ctx.respond("Cancelled scheduled suspension.");
        }
        return ctx.respond("This thread isn't scheduled to be suspended.");
      }

      if (thread.status === THREAD_STATUS.SUSPENDED) return ctx.respond("This thread is already suspended.");

      if (args.time) {
        const delay = utils.convertDelayStringToMS(args.time);
        if (! delay) return ctx.respond("Invalid delay. Format example: \"2h\".");
        const suspendAt = moment.utc().add(delay, "ms");
        await thread.scheduleSuspend(suspendAt.format("YYYY-MM-DD HH:mm:ss"), ctx.author);
        const scheduledBy = config.useDisplaynames ? (ctx.author.globalName || ctx.author.username) : ctx.author.username;
        // Public notice so other staff see the pending suspension; intentionally not ephemeral.
        await thread.postSystemMessage(`Thread will be suspended in ${utils.humanizeDelay(delay)}, scheduled by ${scheduledBy}. Use \`/suspend cancel:true\` to cancel.`);
        return ctx.respond("Scheduled.");
      }

      await thread.suspend();
      await thread.postSystemMessage("**Thread suspended.** It will act as closed until unsuspended with `/unsuspend`.");
      return ctx.respond("Thread suspended.");
    },
  });

  slash.addInboxCommand({
    name: "unsuspend",
    description: "Unsuspend the thread in this channel",
    handler: async (ctx) => {
      const thread = await threads.findSuspendedThreadByChannelId(ctx.channel.id);
      if (! thread) return ctx.respond("This channel isn't a suspended thread.");

      const otherOpenThread = await threads.findOpenThreadByUserId(thread.user_id);
      if (otherOpenThread) {
        return ctx.respond(`Cannot unsuspend; there is another open thread with this user: <#${otherOpenThread.channel_id}>`);
      }

      await thread.unsuspend();
      await thread.postSystemMessage("**Thread unsuspended.**");
      return ctx.respond("Thread unsuspended.");
    },
  });
};
