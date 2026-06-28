const moment = require("moment");
const utils = require("../utils");
const threads = require("../data/threads");
const { getLogUrl, getLogFile, getLogCustomResponse } = require("../data/logs");
const { ApplicationCommandOptionTypes: OPT } = require("eris").Constants;

const LOG_LINES_PER_PAGE = 10;

// Slash equivalent of src/modules/logs.js (/log covers the old log + loglink commands)
module.exports = (slash, { bot }) => {
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
        return ctx.respond({ content: `There are no log files for <@${userId}>.`, allowedMentions: {} }, { persist: true });
      }

      let message = isPaginated
        ? `**Log files for <@${userId}>** (page **${page}/${maxPage}**, showing **${start + 1}-${start + threadLines.length}/${totalUserThreads}**):`
        : `**Log files for <@${userId}>:**`;
      message += `\n${threadLines.join("\n")}`;
      if (isPaginated) message += "\nAdd `page:` to see more.";

      return ctx.respond({ content: message, allowedMentions: {} }, { persist: true });
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
        return ctx.respond(`Log for thread #${target.thread_number}:\n<${addOptQueryStringToUrl(logUrl, args)}>`, { persist: true });
      }

      const logFile = await getLogFile(target);
      if (logFile) {
        await channel.createMessage(`Log for thread #${target.thread_number}:`, logFile).catch(utils.noop);
        return ctx.respond("Log file posted in the channel.");
      }

      return ctx.respond("This thread's logs are not currently available.");
    },
  });
};
