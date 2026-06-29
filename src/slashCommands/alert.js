const { ApplicationCommandOptionTypes: OPT } = require("eris").Constants;

// Slash equivalent of src/modules/alert.js
module.exports = (slash) => {
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
};
