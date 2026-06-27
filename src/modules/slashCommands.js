const Eris = require("eris");
const moment = require("moment");
const humanizeDuration = require("humanize-duration");
const transliterate = require("transliteration");
const { parseArguments } = require("knub-command-manager");
const { Routes } = require("discord-api-types/v10");

const utils = require("../utils");
const threads = require("../data/threads");
const blocked = require("../data/blocked");
const snippetsData = require("../data/snippets");
const { createSlashCommandManager } = require("../slashCommandManager");
const { getLogUrl, getLogFile, getLogCustomResponse } = require("../data/logs");
const { findNotesByUserId, createUserNote, findNote, deleteNote } = require("../data/notes");
const {
  setModeratorThreadRoleOverride,
  resetModeratorThreadRoleOverride,
  getModeratorThreadDisplayRoleName,
  setModeratorDefaultRoleOverride,
  resetModeratorDefaultRoleOverride,
  getModeratorDefaultDisplayRoleName,
} = require("../data/displayRoles");
const updates = require("../data/updates");
const { getPrettyVersion } = require("../botVersion");
const { THREAD_MESSAGE_TYPE, THREAD_STATUS } = require("../data/constants");

const { ApplicationCommandOptionTypes: OPT } = Eris.Constants;

const LOG_LINES_PER_PAGE = 10;

/**
 * Slash command surface for staff. This intentionally lives alongside the existing text command
 * modules (reply.js, close.js, ...) rather than modifying them: those modules keep registering
 * their text commands (now dormant without the message content intent), and this module adds the
 * slash equivalents on top, calling the same data layer. The only upstream files touched by the
 * slash migration are bot.js (intents) and main.js (loading this module).
 */
module.exports = ({ bot, config }) => {
  const slash = createSlashCommandManager(bot);

  // Shared option definitions -------------------------------------------------

  const messageOption = {
    type: OPT.STRING,
    name: "message",
    description: "Message to send to the user",
    required: false,
  };
  const attachmentOption = {
    type: OPT.ATTACHMENT,
    name: "attachment",
    description: "Optional file to include with the reply",
    required: false,
  };

  // Replies -------------------------------------------------------------------

  async function sendReply(ctx, args, thread, isAnonymous) {
    const text = (args.message || "").trim();
    const replyAttachments = args.attachment ? [args.attachment] : [];

    if (! text && replyAttachments.length === 0) {
      return ctx.respond("Add a message or an attachment to send.");
    }

    const replied = await thread.replyToUser(ctx.member, text, replyAttachments, isAnonymous, null);
    return ctx.respond(replied
      ? (isAnonymous ? "Anonymous reply sent." : "Reply sent.")
      : "Could not send the reply. Check the thread for details.");
  }

  slash.addThreadCommand({
    name: "reply",
    description: "Reply to the user in this thread",
    options: [messageOption, attachmentOption],
    handler: (ctx, args, thread) => sendReply(ctx, args, thread, config.forceAnon),
  });

  slash.addThreadCommand({
    name: "anonreply",
    description: "Reply anonymously (shows only your role, not your name)",
    options: [messageOption, attachmentOption],
    handler: (ctx, args, thread) => sendReply(ctx, args, thread, true),
  });

  slash.addThreadCommand({
    name: "realreply",
    description: "Reply showing your name and role (useful when forceAnon is on)",
    options: [messageOption, attachmentOption],
    handler: (ctx, args, thread) => sendReply(ctx, args, thread, false),
  });

  // Edit / delete own replies -------------------------------------------------

  if (config.allowStaffEdit) {
    slash.addThreadCommand({
      name: "edit",
      description: "Edit one of your own replies in this thread",
      options: [
        { type: OPT.INTEGER, name: "number", description: "Reply number shown in the thread", required: true },
        { type: OPT.STRING, name: "text", description: "New reply text", required: true },
      ],
      handler: async (ctx, args, thread) => {
        const threadMessage = await thread.findThreadMessageByMessageNumber(args.number);
        if (! threadMessage) return ctx.respond("Unknown message number.");
        if (threadMessage.user_id !== ctx.author.id) return ctx.respond("You can only edit your own replies.");

        const edited = await thread.editStaffReply(ctx.member, threadMessage, args.text);
        return ctx.respond(edited ? "Reply edited." : "Could not edit the reply.");
      },
    });
  }

  if (config.allowStaffDelete) {
    slash.addThreadCommand({
      name: "delete",
      description: "Delete one of your own replies in this thread",
      options: [
        { type: OPT.INTEGER, name: "number", description: "Reply number shown in the thread", required: true },
      ],
      handler: async (ctx, args, thread) => {
        const threadMessage = await thread.findThreadMessageByMessageNumber(args.number);
        if (! threadMessage) return ctx.respond("Unknown message number.");
        if (threadMessage.user_id !== ctx.author.id) return ctx.respond("You can only delete your own replies.");

        await thread.deleteStaffReply(ctx.member, threadMessage);
        return ctx.respond("Reply deleted.");
      },
    });
  }

  // Close ---------------------------------------------------------------------

  // Mirrored from close.js so an immediate /close reports the same closing notification. Scheduled
  // closes (/close time:...) are still finalised by close.js's own scheduled-close loop.
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

  // Blocking ------------------------------------------------------------------

  if (config.allowBlock) {
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
        if (! blockStatus.isBlocked) return ctx.respond(`<@${userId}> (\`${userId}\`) is **not** blocked.`);
        if (blockStatus.expiresAt) return ctx.respond(`<@${userId}> (\`${userId}\`) is blocked until ${blockStatus.expiresAt} (UTC).`);
        return ctx.respond(`<@${userId}> (\`${userId}\`) is blocked indefinitely.`);
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
        return ctx.respond({ content: reply, allowedMentions: {} });
      },
    });
  }

  // Logs ----------------------------------------------------------------------

  const logSwitchOptions = [
    { type: OPT.BOOLEAN, name: "verbose", description: "Include verbose details in the log link", required: false },
    { type: OPT.BOOLEAN, name: "simple", description: "Use a simplified log view", required: false },
  ];

  const addOptQueryStringToUrl = (url, args) => {
    const params = [];
    if (args.verbose) params.push("verbose=1");
    if (args.simple) params.push("simple=1");
    if (params.length === 0) return url;
    return url + (url.indexOf("?") > -1 ? "&" : "?") + params.join("&");
  };

  slash.addInboxCommand({
    name: "logs",
    description: "List previous modmail logs with a user",
    options: [
      { type: OPT.USER, name: "user", description: "User to list logs for (defaults to this thread's user)", required: false },
      { type: OPT.INTEGER, name: "page", description: "Page number", required: false },
      ...logSwitchOptions,
    ],
    handler: async (ctx, args, thread) => {
      const userId = (args.user && args.user.id) || (thread && thread.user_id);
      if (! userId) return ctx.respond("Specify a user, or run this inside a thread.");

      let userThreads = await threads.getClosedThreadsByUserId(userId);
      userThreads.sort((a, b) => {
        if (a.created_at > b.created_at) return -1;
        if (a.created_at < b.created_at) return 1;
        return 0;
      });

      const totalUserThreads = userThreads.length;
      const maxPage = Math.max(Math.ceil(totalUserThreads / LOG_LINES_PER_PAGE), 1);
      const page = Math.max(Math.min(args.page ? parseInt(args.page, 10) : 1, maxPage), 1);
      const isPaginated = totalUserThreads > LOG_LINES_PER_PAGE;
      const start = (page - 1) * LOG_LINES_PER_PAGE;
      const end = page * LOG_LINES_PER_PAGE;
      userThreads = userThreads.slice(start, end);

      const threadLines = await Promise.all(userThreads.map(async userThread => {
        const logUrl = await getLogUrl(userThread);
        const formattedLogUrl = logUrl
          ? `<${addOptQueryStringToUrl(logUrl, args)}>`
          : `View with \`/log thread_number:${userThread.thread_number}\``;
        const formattedDate = moment.utc(userThread.created_at).format("MMM Do [at] HH:mm [UTC]");
        return `\`#${userThread.thread_number}\` \`${formattedDate}\`: ${formattedLogUrl}`;
      }));

      if (threadLines.length === 0) {
        return ctx.respond({ content: `There are no log files for <@${userId}>.`, allowedMentions: {} });
      }

      let message = isPaginated
        ? `**Log files for <@${userId}>** (page **${page}/${maxPage}**, showing **${start + 1}-${start + threadLines.length}/${totalUserThreads}**):`
        : `**Log files for <@${userId}>:**`;
      message += `\n${threadLines.join("\n")}`;
      if (isPaginated) message += "\nAdd `page:` to see more.";

      return ctx.respond({ content: message, allowedMentions: {} });
    },
  });

  slash.addInboxCommand({
    name: "log",
    description: "Show the log for a specific thread (or this thread)",
    options: [
      { type: OPT.STRING, name: "thread_number", description: "Thread number or ID (defaults to this thread)", required: false },
      ...logSwitchOptions,
    ],
    handler: async (ctx, args, thread) => {
      const threadId = args.thread_number || (thread && thread.id);
      if (! threadId) return ctx.respond("Specify a thread number, or run this inside a thread.");

      const target = (await threads.findById(threadId)) || (await threads.findByThreadNumber(threadId));
      if (! target) return ctx.respond("No thread found with that number or ID.");

      // interaction.channel can be a partial { id } when uncached, so resolve a real channel
      // before posting custom responses or files into it.
      const channel = await utils.getOrFetchChannel(bot, ctx.channel.id);

      const customResponse = await getLogCustomResponse(target);
      if (customResponse && (customResponse.content || customResponse.file)) {
        await channel.createMessage(customResponse.content, customResponse.file).catch(utils.noop);
      }

      const logUrl = await getLogUrl(target);
      if (logUrl) {
        return ctx.respond(`Log for thread #${target.thread_number}:\n<${addOptQueryStringToUrl(logUrl, args)}>`);
      }

      const logFile = await getLogFile(target);
      if (logFile) {
        await channel.createMessage(`Log for thread #${target.thread_number}:`, logFile).catch(utils.noop);
        return ctx.respond("Log file posted in the channel.");
      }

      return ctx.respond("This thread's logs are not currently available.");
    },
  });

  // Helper: send possibly-long output as an ephemeral reply plus follow-ups.
  async function respondChunks(ctx, text) {
    const chunks = utils.chunkMessageLines(text);
    if (! chunks.length) return ctx.respond("(nothing to show)");
    await ctx.respond({ content: chunks[0], allowedMentions: {} });
    for (let i = 1; i < chunks.length; i++) {
      await ctx.followup({ content: chunks[i], allowedMentions: {} });
    }
  }

  // Notes ---------------------------------------------------------------------

  if (config.allowNotes) {
    slash.addInboxCommand({
      name: "note",
      description: "Add, list, or delete staff notes about a user",
      options: [
        {
          type: OPT.SUB_COMMAND, name: "add", description: "Add a note about a user",
          options: [
            { type: OPT.STRING, name: "text", description: "Note text", required: true },
            { type: OPT.USER, name: "user", description: "User (defaults to this thread's user)", required: false },
          ],
        },
        {
          type: OPT.SUB_COMMAND, name: "list", description: "List notes about a user",
          options: [{ type: OPT.USER, name: "user", description: "User (defaults to this thread's user)", required: false }],
        },
        {
          type: OPT.SUB_COMMAND, name: "delete", description: "Delete a note by its ID",
          options: [{ type: OPT.INTEGER, name: "id", description: "Note ID (shown in the notes list)", required: true }],
        },
      ],
      handler: async (ctx, args, thread) => {
        if (args._subcommand === "add") {
          const userId = (args.user && args.user.id) || (thread && thread.user_id);
          if (! userId) return ctx.respond("Specify a user, or run this inside a thread.");
          await createUserNote(userId, ctx.author.id, args.text);
          return ctx.respond({ content: `Note added for <@${userId}>.`, allowedMentions: {} });
        }
        if (args._subcommand === "list") {
          const userId = (args.user && args.user.id) || (thread && thread.user_id);
          if (! userId) return ctx.respond("Specify a user, or run this inside a thread.");
          const userNotes = await findNotesByUserId(userId);
          if (! userNotes.length) return ctx.respond({ content: `There are no notes for <@${userId}>.`, allowedMentions: {} });
          const blocks = userNotes.map(note => {
            const timestamp = moment.utc(note.created_at).format("X");
            return `**#${note.id}** by <@${note.author_id}> at <t:${timestamp}:f>:\n${utils.START_CODEBLOCK}${utils.escapeMarkdown(note.body)}${utils.END_CODEBLOCK}`;
          });
          return respondChunks(ctx, blocks.join("\n"));
        }
        // delete
        const note = await findNote(args.id);
        if (! note) return ctx.respond("Note not found.");
        await deleteNote(args.id);
        return ctx.respond({
          content: `Deleted note #${args.id} on <@${note.user_id}>:\n${utils.START_CODEBLOCK}${utils.escapeMarkdown(note.body)}${utils.END_CODEBLOCK}`,
          allowedMentions: {},
        });
      },
    });
  }

  // Display roles -------------------------------------------------------------

  if (config.allowChangingDisplayRole) {
    // In a thread channel these act on the per-thread display role; elsewhere on the default role.
    slash.addInboxCommand({
      name: "role",
      description: "Show, set, or reset the role displayed on your replies",
      options: [
        { type: OPT.SUB_COMMAND, name: "show", description: "Show your current display role" },
        {
          type: OPT.SUB_COMMAND, name: "set", description: "Set your display role (you must have the role)",
          options: [{ type: OPT.ROLE, name: "role", description: "Role to display", required: true }],
        },
        { type: OPT.SUB_COMMAND, name: "reset", description: "Reset your display role" },
      ],
      handler: async (ctx, args, thread) => {
        // /role acts on the per-thread display role inside any thread channel (including suspended
        // ones) and on the moderator's default role elsewhere. Inbox scope only passes open
        // threads, so re-resolve here to also catch suspended threads, matching roles.js.
        const threadForRole = thread || await threads.findByChannelId(ctx.channel.id);
        const inThread = !! threadForRole;
        const scopeLabel = inThread ? "in this thread" : "by default";

        if (args._subcommand === "show") {
          const displayRole = inThread
            ? await getModeratorThreadDisplayRoleName(ctx.member, threadForRole.id)
            : await getModeratorDefaultDisplayRoleName(ctx.member);
          return ctx.respond(displayRole
            ? `Your display role ${scopeLabel} is currently **${displayRole}**.`
            : `Your replies ${scopeLabel} do not currently display a role.`);
        }

        if (args._subcommand === "set") {
          const role = args.role;
          if (! role || ! ctx.member.roles.includes(role.id)) {
            return ctx.respond("No matching role, or you don't have that role.");
          }
          if (inThread) {
            await setModeratorThreadRoleOverride(ctx.member.id, threadForRole.id, role.id);
            return ctx.respond(`Your display role for this thread is now **${role.name}**.`);
          }
          await setModeratorDefaultRoleOverride(ctx.member.id, role.id);
          return ctx.respond(`Your default display role is now **${role.name}**.`);
        }

        // reset
        if (inThread) {
          await resetModeratorThreadRoleOverride(ctx.member.id, threadForRole.id);
          const displayRole = await getModeratorThreadDisplayRoleName(ctx.member, threadForRole.id);
          return ctx.respond(displayRole
            ? `Reset. Your replies here will now show the default role **${displayRole}**.`
            : "Reset. Your replies here will no longer display a role.");
        }
        await resetModeratorDefaultRoleOverride(ctx.member.id);
        const displayRole = await getModeratorDefaultDisplayRoleName(ctx.member);
        return ctx.respond(displayRole
          ? `Reset. Your replies will now show **${displayRole}** by default.`
          : "Reset. Your replies will no longer display a role by default.");
      },
    });
  }

  // Suspend / unsuspend -------------------------------------------------------

  if (config.allowSuspend) {
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
          return ctx.respond(`Thread will be suspended in ${utils.humanizeDelay(delay)}. Use \`/suspend cancel:true\` to cancel.`);
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
  }

  // Move ----------------------------------------------------------------------

  if (config.allowMove) {
    slash.addThreadCommand({
      name: "move",
      description: "Move this thread to another category",
      options: [{ type: OPT.STRING, name: "category", description: "Target category name", required: true }],
      handler: async (ctx, args, thread) => {
        const normalizedSearchStr = transliterate.slugify(args.category);
        const channel = await utils.getOrFetchChannel(bot, ctx.channel.id);
        const categories = channel.guild.channels.filter(c => (c instanceof Eris.CategoryChannel) && (c.id !== channel.parentID));
        if (categories.length === 0) return ctx.respond("There are no categories to move to.");

        const containsRankings = categories.map(cat => {
          const normalizedCatName = transliterate.slugify(cat.name);
          let i = 0;
          do {
            if (! normalizedCatName.includes(normalizedSearchStr.slice(0, i + 1))) break;
            i++;
          } while (i < normalizedSearchStr.length);
          if (i > 0 && normalizedCatName.startsWith(normalizedSearchStr.slice(0, i))) i += 0.5;
          return [cat, i];
        });
        containsRankings.sort((a, b) => (a[1] > b[1] ? -1 : 1));
        if (containsRankings[0][1] === 0) return ctx.respond("No matching category.");

        const targetCategory = containsRankings[0][0];
        try {
          await bot.editChannel(thread.channel_id, { parentID: targetCategory.id });
        } catch (e) {
          return ctx.respond(`Failed to move thread: ${e.message}`);
        }

        if (config.syncPermissionsOnMove) {
          const newPerms = Array.from(targetCategory.permissionOverwrites.map(ow => ({
            id: ow.id, type: ow.type, allow: ow.allow, deny: ow.deny,
          })));
          try {
            await bot.requestHandler.request("PATCH", Routes.channel(thread.channel_id), true, { permission_overwrites: newPerms });
          } catch (e) {
            await thread.postSystemMessage(`Thread moved to ${targetCategory.name.toUpperCase()}, but failed to sync permissions: ${e.message}`);
            return ctx.respond("Moved, but permission sync failed (see the thread).");
          }
        }

        await thread.postSystemMessage(`Thread moved to ${targetCategory.name.toUpperCase()}`);
        return ctx.respond(`Moved to ${targetCategory.name.toUpperCase()}.`);
      },
    });
  }

  // Alerts --------------------------------------------------------------------

  slash.addThreadCommand({
    name: "alert",
    description: "Get pinged when this thread gets a new reply",
    allowSuspended: true,
    options: [{ type: OPT.BOOLEAN, name: "cancel", description: "Stop alerting you for this thread", required: false }],
    handler: async (ctx, args, thread) => {
      if (args.cancel) {
        await thread.removeAlert(ctx.author.id);
        await thread.postSystemMessage("Cancelled new message alert");
        return ctx.respond("Alert cancelled.");
      }
      await thread.addAlert(ctx.author.id);
      await thread.postSystemMessage(`Pinging ${ctx.author.globalName || ctx.author.username} when this thread gets a new reply`);
      return ctx.respond("You'll be pinged on the next reply in this thread.");
    },
  });

  // Thread info ---------------------------------------------------------------

  slash.addThreadCommand({
    name: "id",
    description: "Show the user ID for this thread",
    allowSuspended: true,
    handler: async (ctx, args, thread) => {
      await thread.postSystemMessage(thread.user_id);
      return ctx.respond(`User ID: \`${thread.user_id}\``);
    },
  });

  slash.addThreadCommand({
    name: "message",
    description: "Show details and a link for a message in this thread",
    allowSuspended: true,
    options: [{ type: OPT.INTEGER, name: "number", description: "Message number shown in the thread", required: true }],
    handler: async (ctx, args, thread) => {
      const threadMessage = await thread.findThreadMessageByMessageNumber(args.number);
      if (! threadMessage) return ctx.respond("No message in this thread with that number.");

      const channelId = threadMessage.dm_channel_id;
      const channelIdServer = utils.getMainGuilds().find(g => g.channels.has(channelId));
      const messageLink = channelIdServer
        ? `https://discord.com/channels/${channelIdServer.id}/${channelId}/${threadMessage.dm_message_id}`
        : `https://discord.com/channels/@me/${channelId}/${threadMessage.dm_message_id}`;

      return ctx.respond([
        `Details for message \`${threadMessage.message_number}\`:`,
        `Channel ID: \`${channelId}\``,
        `Message ID: \`${threadMessage.dm_message_id}\``,
        `Link: <${messageLink}>`,
      ].join("\n"));
    },
  });

  // New thread ----------------------------------------------------------------

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
      return ctx.respond(`Thread opened: <#${createdThread.channel_id}>`);
    },
  });

  // Version -------------------------------------------------------------------

  slash.addInboxCommand({
    name: "version",
    description: "Show the modmail bot version",
    handler: async (ctx) => {
      let response = `Modmail ${getPrettyVersion()}`;
      if (config.updateNotifications) {
        const availableUpdate = await updates.getAvailableUpdate();
        if (availableUpdate) response += ` (version ${availableUpdate} available)`;
      }
      return ctx.respond(response);
    },
  });

  // Snippets ------------------------------------------------------------------

  if (config.allowSnippets) {
    // Mirrored from snippets.js
    const renderSnippet = (body, snippetArgs) => body
      .replace(/(?<!\\){\d+}/g, match => {
        const index = parseInt(match.slice(1, -1), 10) - 1;
        return (snippetArgs[index] != null ? snippetArgs[index] : match);
      })
      .replace(/\\{/g, "{");

    const snippetNameOption = {
      type: OPT.STRING, name: "name", description: "Snippet name", required: true, autocomplete: true,
    };

    slash.addInboxCommand({
      name: "snippet",
      description: "Send a snippet, or manage the snippet list",
      autocomplete: async (value) => {
        const all = await snippetsData.all();
        const needle = (value || "").toLowerCase();
        return all
          .filter(s => s.trigger.toLowerCase().includes(needle))
          .map(s => ({ name: s.trigger, value: s.trigger }));
      },
      options: [
        {
          type: OPT.SUB_COMMAND, name: "send", description: "Send a snippet as a reply in this thread",
          options: [
            snippetNameOption,
            { type: OPT.STRING, name: "args", description: "Arguments for {1}, {2}, ... placeholders", required: false },
            { type: OPT.BOOLEAN, name: "anon", description: "Send anonymously", required: false },
          ],
        },
        { type: OPT.SUB_COMMAND, name: "list", description: "List all snippets" },
        { type: OPT.SUB_COMMAND, name: "show", description: "Show a snippet's content", options: [snippetNameOption] },
        {
          type: OPT.SUB_COMMAND, name: "add", description: "Create a new snippet",
          options: [
            { type: OPT.STRING, name: "name", description: "Snippet name", required: true },
            { type: OPT.STRING, name: "text", description: "Snippet content", required: true },
          ],
        },
        {
          type: OPT.SUB_COMMAND, name: "edit", description: "Edit a snippet's content",
          options: [snippetNameOption, { type: OPT.STRING, name: "text", description: "New content", required: true }],
        },
        { type: OPT.SUB_COMMAND, name: "delete", description: "Delete a snippet", options: [snippetNameOption] },
      ],
      handler: async (ctx, args, thread) => {
        if (args._subcommand === "send") {
          if (! thread) return ctx.respond("Use this inside a modmail thread channel.");
          const snippet = await snippetsData.get(args.name);
          if (! snippet) return ctx.respond(`No snippet named "${args.name}".`);
          const argList = args.args ? parseArguments(args.args).map(a => a.value) : [];
          const rendered = renderSnippet(snippet.body, argList);
          const isAnonymous = config.forceAnon || !! args.anon;
          const replied = await thread.replyToUser(ctx.member, rendered, [], isAnonymous, null);
          return ctx.respond(replied ? "Snippet sent." : "Could not send the snippet. Check the thread for details.");
        }
        if (args._subcommand === "list") {
          const all = await snippetsData.all();
          if (! all.length) return ctx.respond("No snippets are defined.");
          const triggers = all.map(s => s.trigger).sort();
          return respondChunks(ctx, `**Snippets** (${triggers.length}): ${triggers.join(", ")}`);
        }
        if (args._subcommand === "show") {
          const snippet = await snippetsData.get(args.name);
          if (! snippet) return ctx.respond(`No snippet named "${args.name}".`);
          return ctx.respond(`\`${args.name}\` replies with:\n${utils.START_CODEBLOCK}${utils.disableCodeBlocks(snippet.body)}${utils.END_CODEBLOCK}`);
        }
        if (args._subcommand === "add") {
          if (await snippetsData.get(args.name)) return ctx.respond(`Snippet "${args.name}" already exists. Use \`/snippet edit\`.`);
          await snippetsData.add(args.name, args.text, ctx.author.id);
          return ctx.respond(`Snippet "${args.name}" created.`);
        }
        if (args._subcommand === "edit") {
          if (! await snippetsData.get(args.name)) return ctx.respond(`Snippet "${args.name}" doesn't exist.`);
          await snippetsData.del(args.name);
          await snippetsData.add(args.name, args.text, ctx.author.id);
          return ctx.respond(`Snippet "${args.name}" edited.`);
        }
        // delete
        if (! await snippetsData.get(args.name)) return ctx.respond(`Snippet "${args.name}" doesn't exist.`);
        await snippetsData.del(args.name);
        return ctx.respond(`Snippet "${args.name}" deleted.`);
      },
    });
  }

  // ---------------------------------------------------------------------------

  // Register everything with the inbox server once plugins have finished loading.
  registerSlashCommands(slash, config);
};

async function registerSlashCommands(slash, config) {
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
