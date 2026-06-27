const moment = require("moment");
const utils = require("../utils");
const { getLogUrl, getLogFile, getLogCustomResponse } = require("../data/logs");
const { THREAD_MESSAGE_TYPE } = require("../data/constants");
const { ApplicationCommandOptionTypes: OPT } = require("eris").Constants;

// Slash equivalent of src/modules/close.js (staff close path only; user-side !close stays on the
// text command in DMs). Scheduled closes are still finalised by close.js's own loop.
module.exports = (slash, { config }) => {
  // Mirrored from close.js so an immediate /close reports the same closing notification.
  async function getMessagesAmounts(thread) {
    const messages = await thread.getThreadMessages();
    let chat = 0, toUser = 0, fromUser = 0;
    for (const message of messages) {
      if (message.message_type === THREAD_MESSAGE_TYPE.CHAT) chat++;
      else if (message.message_type === THREAD_MESSAGE_TYPE.TO_USER) toUser++;
      else if (message.message_type === THREAD_MESSAGE_TYPE.FROM_USER) fromUser++;
    }
    return [
      `**${fromUser}** message${fromUser !== 1 ? "s" : ""} from the user`,
      `, **${toUser}** message${toUser !== 1 ? "s" : ""} to the user`,
      ` and **${chat}** internal chat message${chat !== 1 ? "s" : ""}.`,
    ].join("");
  }

  async function sendCloseNotification(thread, body) {
    const logCustomResponse = await getLogCustomResponse(thread);
    if (logCustomResponse) {
      await utils.postLog(body);
      await utils.postLog(logCustomResponse.content, logCustomResponse.file);
      return;
    }

    body = `${body}\n${await getMessagesAmounts(thread)}`;

    const logUrl = await getLogUrl(thread);
    if (logUrl) {
      utils.postLog(utils.trimAll(`
          ${body}
          Logs: ${logUrl}
        `));
      return;
    }

    const logFile = await getLogFile(thread);
    if (logFile) {
      utils.postLog(body, logFile);
      return;
    }

    utils.postLog(body);
  }

  slash.addThreadCommand({
    name: "close",
    description: "Close this modmail thread",
    options: [
      { type: OPT.STRING, name: "time", description: "Close after a delay, e.g. \"1h30m\"", required: false },
      { type: OPT.BOOLEAN, name: "silent", description: "Close without notifying the user", required: false },
      { type: OPT.BOOLEAN, name: "cancel", description: "Cancel a scheduled close", required: false },
    ],
    handler: async (ctx, args, thread) => {
      const silentClose = !! args.silent;

      if (args.cancel) {
        if (thread.scheduled_close_at) {
          await thread.cancelScheduledClose();
          return ctx.respond("Cancelled scheduled closing.");
        }
        return ctx.respond("This thread isn't scheduled to close.");
      }

      if (args.time) {
        const delay = utils.convertDelayStringToMS(args.time);
        if (delay === 0 || delay === null) {
          return ctx.respond("Invalid delay. Format example: \"1h30m\".");
        }

        const closeAt = moment.utc().add(delay, "ms");
        await thread.scheduleClose(closeAt.format("YYYY-MM-DD HH:mm:ss"), ctx.author, silentClose ? 1 : 0);
        return ctx.respond(
          `Thread will close ${silentClose ? "silently " : ""}in ${utils.humanizeDelay(delay)}. Use \`/close cancel:true\` to cancel.`
        );
      }

      if (config.closeMessage && ! silentClose) {
        const closeMessage = utils.readMultilineConfigValue(config.closeMessage);
        await thread.sendSystemMessageToUser(closeMessage).catch(() => {});
      }

      const closedBy = config.useDisplaynames ? (ctx.author.globalName || ctx.author.username) : ctx.author.username;
      await thread.close(false, silentClose);
      await sendCloseNotification(
        thread,
        `Modmail thread #${thread.thread_number} with ${thread.user_name} (${thread.user_id}) was closed by ${closedBy} (${ctx.author.id})`
      );
      return ctx.respond("Thread closed.");
    },
  });
};
