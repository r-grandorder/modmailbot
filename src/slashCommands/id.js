const utils = require("../utils");
const { ApplicationCommandOptionTypes: OPT } = require("eris").Constants;

// Slash equivalent of src/modules/id.js (id + message; dm_channel_id is omitted)
module.exports = (slash) => {
  slash.addThreadCommand({
    name: "id",
    description: "Show the user ID for this thread",
    allowSuspended: true,
    handler: async (ctx, args, thread) => {
      await thread.postSystemMessage(thread.user_id);
      return ctx.respond(`User ID: \`${thread.user_id}\``, { persist: true });
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
      ].join("\n"), { persist: true });
    },
  });
};
