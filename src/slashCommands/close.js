const moment = require("moment");
const utils = require("../utils");
const threads = require("../data/threads");
const { getLogUrl, getLogFile, getLogCustomResponse } = require("../data/logs");
const { THREAD_MESSAGE_TYPE } = require("../data/constants");
const { ApplicationCommandOptionTypes: OPT } = require("eris").Constants;

// Slash equivalent of src/modules/close.js (staff close path only; user-side !close stays on the
// text command in DMs). Scheduled closes are still finalised by close.js's own loop.
//
// Both an immediate and a timed /close open a note-capture modal first. The note is posted into the
// ticket channel and saved to the log; for a timed close it stays visible while the timer runs.
// This is the mitigation for dropping staff side-chat logging: channel chatter is no longer
// captured (no message content intent), so this is where the closer records context worth keeping.
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

  // Banner so the closing note stands apart from surrounding lines, both in the channel and in
  // the exported log.
  function formatNote(closedByName, note) {
    const divider = "========================================";
    return `\n${divider}\nCLOSING NOTE from ${closedByName}\n${divider}\n\n${note}\n\n${divider}\n`;
  }

  // Immediate close: send the close message, close the thread, post the closing notification.
  async function performClose(thread, { silent, closedByName, closedById }) {
    if (config.closeMessage && ! silent) {
      const closeMessage = utils.readMultilineConfigValue(config.closeMessage);
      await thread.sendSystemMessageToUser(closeMessage).catch(() => {});
    }

    await thread.close(false, silent);
    await sendCloseNotification(
      thread,
      `Modmail thread #${thread.thread_number} with ${thread.user_name} (${thread.user_id}) was closed by ${closedByName} (${closedById})`
    );
  }

  slash.addThreadCommand({
    name: "close",
    description: "Close this modmail thread",
    deferReply: false, // close opens a modal, which has to be the first response
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
          const cancelledBy = config.useDisplaynames ? (ctx.author.globalName || ctx.author.username) : ctx.author.username;
          // Public so other staff who saw the scheduled-close notice know it is no longer closing.
          await thread.postSystemMessage(`Scheduled close cancelled by ${cancelledBy}.`);
          return ctx.respond("Cancelled scheduled closing.");
        }
        return ctx.respond("This thread isn't scheduled to close.");
      }

      let delayMs = 0;
      if (args.time) {
        delayMs = utils.convertDelayStringToMS(args.time);
        if (delayMs === 0 || delayMs === null) {
          return ctx.respond("Invalid delay. Format example: \"1h30m\".");
        }
      }

      // Open the note modal for both immediate and timed closes. The actual close (now or
      // scheduled) happens on submit; the delay (0 for immediate) rides along in the custom_id.
      return ctx.openModal({
        title: "Close thread",
        custom_id: `close:${thread.channel_id}:${silentClose ? 1 : 0}:${delayMs}`,
        components: [{
          type: 1, // action row
          components: [{
            type: 4, // text input
            custom_id: "note",
            style: 2, // paragraph
            label: "Notes to save (optional)",
            placeholder: "Only the user's messages and your /replies are saved. Add anything else worth keeping.",
            required: false,
            max_length: 4000,
          }],
        }],
      });
    },
  });

  slash.addModalHandler("close", async (ctx, fields, customId) => {
    const [, channelId, silentFlag, delayStr] = customId.split(":");
    const thread = await threads.findOpenThreadByChannelId(channelId);
    if (! thread) return ctx.respond("This thread is no longer open.");

    const silent = silentFlag === "1";
    const delayMs = parseInt(delayStr, 10) || 0;
    const note = (fields.note || "").trim();
    const closedByName = config.useDisplaynames ? (ctx.author.globalName || ctx.author.username) : ctx.author.username;

    if (delayMs > 0) {
      const closeAt = moment.utc().add(delayMs, "ms");
      await thread.scheduleClose(closeAt.format("YYYY-MM-DD HH:mm:ss"), ctx.author, silent ? 1 : 0);
      const humanized = utils.humanizeDelay(delayMs);
      // One public notice in the channel, with the note inline if there is one, so other staff
      // see the pending close. This is the "will close in X" message, intentionally not ephemeral.
      let notice = `Thread will close ${silent ? "silently " : ""}in ${humanized}, scheduled by ${closedByName}. Use \`/close cancel:true\` to cancel.`;
      if (note) notice += `\n${formatNote(closedByName, note)}`;
      await thread.postSystemMessage(notice);
      return ctx.respond(note ? "Scheduled. Note saved." : "Scheduled.");
    }

    // Immediate close: post the note (if any) to the channel + log, then close now.
    if (note) {
      await thread.postSystemMessage(formatNote(closedByName, note));
    }
    await performClose(thread, { silent, closedByName, closedById: ctx.author.id });
    return ctx.respond(note ? "Thread closed. Your note was saved to the log." : "Thread closed.");
  });
};
