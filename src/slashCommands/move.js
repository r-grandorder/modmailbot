const Eris = require("eris");
const transliterate = require("transliteration");
const { Routes } = require("discord-api-types/v10");
const utils = require("../utils");

const { ApplicationCommandOptionTypes: OPT } = Eris.Constants;

// Slash equivalent of src/modules/move.js
module.exports = (slash, { bot, config }) => {
  if (! config.allowMove) return;

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
};
