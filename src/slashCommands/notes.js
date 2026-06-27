const moment = require("moment");
const utils = require("../utils");
const { findNotesByUserId, createUserNote, findNote, deleteNote } = require("../data/notes");
const { ApplicationCommandOptionTypes: OPT } = require("eris").Constants;

// Slash equivalent of src/modules/notes.js
module.exports = (slash, { config }) => {
  if (! config.allowNotes) return;

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
        return ctx.respondChunks(blocks.join("\n"));
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
};
