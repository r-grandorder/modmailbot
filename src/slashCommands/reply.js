const { ApplicationCommandOptionTypes: OPT } = require("eris").Constants;

// Slash equivalent of src/modules/reply.js
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

module.exports = (slash, { config }) => {
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
};
