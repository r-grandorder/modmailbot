const threads = require("../data/threads");
const {
  setModeratorThreadRoleOverride,
  resetModeratorThreadRoleOverride,
  getModeratorThreadDisplayRoleName,
  setModeratorDefaultRoleOverride,
  resetModeratorDefaultRoleOverride,
  getModeratorDefaultDisplayRoleName,
} = require("../data/displayRoles");
const { ApplicationCommandOptionTypes: OPT } = require("eris").Constants;

// Slash equivalent of src/modules/roles.js
module.exports = (slash, { config }) => {
  if (! config.allowChangingDisplayRole) return;

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
};
