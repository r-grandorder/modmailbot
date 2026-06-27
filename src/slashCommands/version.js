const updates = require("../data/updates");
const { getPrettyVersion } = require("../botVersion");

// Slash equivalent of src/modules/version.js
module.exports = (slash, { config }) => {
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
};
