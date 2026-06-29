const Eris = require("eris");
const config = require("./cfg");
const utils = require("./utils");
const threads = require("./data/threads");

const {
  ApplicationCommandTypes,
  ApplicationCommandOptionTypes,
  InteractionTypes,
} = Eris.Constants;

const EPHEMERAL = 64;

// Transient ephemeral confirmations (e.g. "Reply sent") self-delete after this long so they don't
// pile up in the invoker's view. Output meant to be read (logs, IDs, lists) opts out with
// { persist: true }. Best effort: if Discord rejects the delete, the message simply stays.
const EPHEMERAL_TTL = 10000;

/**
 * A small slash command layer for modmail.
 *
 * It mirrors the scoping rules of the text command manager (commands.js):
 *   - "thread" commands must be run inside an open (or, with allowSuspended, suspended) thread
 *     channel; the resolved thread is passed to the handler.
 *   - "inbox" commands can be run anywhere on the inbox server; if the channel happens to be a
 *     thread channel, that thread is passed to the handler (otherwise null), matching how the
 *     text commands fall back to `thread && thread.user_id`.
 *   - "global" commands run without a pre-resolved thread; the handler resolves what it needs.
 *
 * Every scope is staff-only and inbox-server-only. Handlers receive (ctx, args, thread):
 *   - ctx:   { interaction, channel, member, author, respond(), followup() }
 *   - args:  option values keyed by option name (USER -> Eris.User, ATTACHMENT -> attachment
 *            object, booleans/strings/integers as-is, `_subcommand` for the chosen subcommand)
 *   - thread: the resolved Thread, or null
 *
 * @param {Eris.Client} bot
 */
function createSlashCommandManager(bot) {
  /** @type {Map<string, object>} name -> definition */
  const defs = new Map();

  /**
   * @param {object} def
   * @param {string} def.name Lowercase command name (Discord constraints apply)
   * @param {string} def.description Shown in the Discord command picker
   * @param {Array<object>} [def.options] Discord application command options
   * @param {"thread"|"inbox"|"global"} [def.scope]
   * @param {boolean} [def.allowSuspended] For thread scope, also match suspended threads
   * @param {function} def.handler async (ctx, args, thread)
   * @param {function} [def.autocomplete] async (focusedValue, interaction) => choices[]
   * @param {string} [def.ack] Fallback ephemeral confirmation if the handler doesn't respond
   */
  function addCommand(def) {
    if (! def || ! def.name) throw new Error("Slash command requires a name");
    if (defs.has(def.name)) return defs.get(def.name);

    const stored = {
      scope: "inbox",
      options: [],
      ...def,
    };
    defs.set(def.name, stored);
    return stored;
  }

  const addThreadCommand = (def) => addCommand({ ...def, scope: "thread" });
  const addInboxCommand = (def) => addCommand({ ...def, scope: "inbox" });
  const addGlobalCommand = (def) => addCommand({ ...def, scope: "global" });

  // Modal submit handlers, matched by custom_id prefix: "close" matches custom_id "close" and
  // any "close:...". Handlers receive (ctx, fields, customId) where fields maps text-input
  // custom_id -> submitted value.
  const modalHandlers = [];
  const addModalHandler = (prefix, handler) => modalHandlers.push({ prefix, handler });

  /**
   * Build the payload for bulkEditGuildCommands.
   * @returns {Array<object>}
   */
  function buildPayload() {
    // Registered as guild commands on the inbox server, so they're never available in DMs and
    // need no dm_permission. Staff-only access is enforced at dispatch time via utils.isStaff.
    return [...defs.values()].map(def => ({
      type: ApplicationCommandTypes.CHAT_INPUT,
      name: def.name,
      description: def.description || def.name,
      options: def.options || [],
    }));
  }

  /**
   * Register every defined command with the inbox server as guild commands (instant rollout).
   * @returns {Promise}
   */
  function registerCommands() {
    return bot.bulkEditGuildCommands(config.inboxServerId, buildPayload());
  }

  function isOnInboxServer(interaction) {
    return interaction.guildID != null && interaction.guildID === config.inboxServerId;
  }

  /**
   * Flatten an interaction's options (including a single subcommand level) into a plain object,
   * resolving USER and ATTACHMENT options to their objects.
   */
  function readOptions(interaction) {
    const data = interaction.data || {};
    const resolved = data.resolved || {};
    const out = {};

    const fromCollection = (collection, id) => {
      if (! collection) return undefined;
      return collection.get ? collection.get(id) : collection[id];
    };

    const resolveValue = (opt) => {
      switch (opt.type) {
        case ApplicationCommandOptionTypes.USER:
          return fromCollection(resolved.users, opt.value) || { id: opt.value };
        case ApplicationCommandOptionTypes.ATTACHMENT:
          return (resolved.attachments || {})[opt.value] || null;
        case ApplicationCommandOptionTypes.CHANNEL:
          return fromCollection(resolved.channels, opt.value) || { id: opt.value };
        case ApplicationCommandOptionTypes.ROLE:
          return fromCollection(resolved.roles, opt.value) || { id: opt.value };
        default:
          return opt.value;
      }
    };

    const walk = (options) => {
      for (const opt of options || []) {
        if (
          opt.type === ApplicationCommandOptionTypes.SUB_COMMAND ||
          opt.type === ApplicationCommandOptionTypes.SUB_COMMAND_GROUP
        ) {
          out._subcommand = out._subcommand ? `${out._subcommand} ${opt.name}` : opt.name;
          walk(opt.options);
        } else {
          out[opt.name] = resolveValue(opt);
        }
      }
    };

    walk(data.options);
    return out;
  }

  function makeContext(interaction) {
    const member = interaction.member || null;
    const author = member ? member.user : interaction.user;

    return {
      interaction,
      channel: interaction.channel,
      member,
      author,
      _responded: false,

      /**
       * Send (or, once acknowledged, edit in) an ephemeral reply visible only to the invoker.
       * Auto-deletes after EPHEMERAL_TTL unless opts.persist is set (for output meant to be read).
       */
      respond(content, opts = {}) {
        this._responded = true;
        const payload = typeof content === "string" ? { content } : { ...content };
        let result;
        if (interaction.acknowledged) {
          result = interaction.editOriginalMessage(payload).catch(utils.noop);
        } else {
          payload.flags = (payload.flags || 0) | EPHEMERAL;
          result = interaction.createMessage(payload).catch(utils.noop);
        }
        if (! opts.persist && typeof interaction.deleteOriginalMessage === "function") {
          setTimeout(() => interaction.deleteOriginalMessage().catch(utils.noop), EPHEMERAL_TTL);
        }
        return result;
      },

      /**
       * Send an additional ephemeral message (for output that spans multiple messages).
       */
      followup(content) {
        const payload = typeof content === "string" ? { content } : { ...content };
        payload.flags = (payload.flags || 0) | EPHEMERAL;
        return interaction.createFollowup(payload).catch(utils.noop);
      },

      /**
       * Send possibly-long output as an ephemeral reply plus follow-ups, splitting on lines.
       */
      async respondChunks(text) {
        const chunks = utils.chunkMessageLines(text);
        if (! chunks.length) return this.respond("(nothing to show)");
        // Lists are meant to be read, so keep them (follow-ups aren't auto-deleted regardless).
        await this.respond({ content: chunks[0], allowedMentions: {} }, { persist: true });
        for (let i = 1; i < chunks.length; i++) {
          await this.followup({ content: chunks[i], allowedMentions: {} });
        }
      },

      /**
       * Respond by opening a modal. Only valid as the first response to a command interaction, so
       * the command must be registered with deferReply: false. The matching modal submit is routed
       * by custom_id (see addModalHandler).
       */
      openModal(modal) {
        this._responded = true;
        if (typeof interaction.createModal !== "function") return Promise.resolve();
        return interaction.createModal(modal).catch(utils.noop);
      },
    };
  }

  async function resolveThread(def, interaction) {
    if (def.scope === "thread") {
      const thread = def.allowSuspended
        ? await threads.findByChannelId(interaction.channel.id)
        : await threads.findOpenThreadByChannelId(interaction.channel.id);
      return thread || null;
    }
    if (def.scope === "inbox") {
      return (await threads.findOpenThreadByChannelId(interaction.channel.id)) || null;
    }
    return null;
  }

  async function dispatchCommand(interaction) {
    const def = defs.get(interaction.data.name);
    if (! def) return;

    const ctx = makeContext(interaction);

    if (! isOnInboxServer(interaction)) {
      return ctx.respond("This command can only be used on the modmail inbox server.");
    }
    if (! utils.isStaff(interaction.member)) {
      return ctx.respond("You don't have permission to use this command.");
    }

    const thread = await resolveThread(def, interaction);
    if (def.scope === "thread" && ! thread) {
      return ctx.respond("Use this command inside a modmail thread channel.");
    }

    const args = readOptions(interaction);

    // Defer ephemerally so slower handlers never trip Discord's 3 second response window. Commands
    // that open a modal must NOT defer (a modal has to be the first response), so they opt out with
    // deferReply: false and are responsible for responding within the window themselves.
    if (def.deferReply !== false) {
      try {
        await interaction.acknowledge(EPHEMERAL);
      } catch (err) {
        // Already acknowledged or the interaction expired; nothing to do.
      }
    }

    try {
      await def.handler(ctx, args, thread);
    } catch (err) {
      console.error(`[slash:${def.name}]`, err);
      return ctx.respond(`⚠ ${err.message || "Something went wrong."}`);
    }

    if (! ctx._responded) {
      await ctx.respond(def.ack || "Done.");
    }
  }

  function findFocusedOption(options) {
    for (const opt of options || []) {
      if (opt.focused) return opt;
      if (opt.options) {
        const nested = findFocusedOption(opt.options);
        if (nested) return nested;
      }
    }
    return null;
  }

  async function dispatchAutocomplete(interaction) {
    const def = defs.get(interaction.data.name);
    if (! def || typeof def.autocomplete !== "function") {
      return interaction.result([]).catch(utils.noop);
    }

    const focused = findFocusedOption(interaction.data.options);
    let choices = [];
    try {
      choices = (await def.autocomplete(focused ? focused.value : "", interaction)) || [];
    } catch (err) {
      console.error(`[slash-autocomplete:${def.name}]`, err);
    }
    return interaction.result(choices.slice(0, 25)).catch(utils.noop);
  }

  // Flatten a modal's submitted action rows into { textInputCustomId: value }.
  function readModalFields(interaction) {
    const fields = {};
    for (const row of (interaction.data.components || [])) {
      for (const component of (row.components || [])) {
        if (component.custom_id != null) fields[component.custom_id] = component.value;
      }
    }
    return fields;
  }

  async function dispatchModal(interaction) {
    const customId = interaction.data.custom_id || "";
    const entry = modalHandlers.find(h => customId === h.prefix || customId.startsWith(`${h.prefix}:`));
    if (! entry) return;

    const ctx = makeContext(interaction);

    if (! isOnInboxServer(interaction)) {
      return ctx.respond("This can only be used on the modmail inbox server.");
    }
    if (! utils.isStaff(interaction.member)) {
      return ctx.respond("You don't have permission to do this.");
    }

    // Modal submits can be deferred (unlike opening a modal), so defer ephemerally for the work.
    try {
      await interaction.defer(EPHEMERAL);
    } catch (err) {
      // Already acknowledged or expired.
    }

    try {
      await entry.handler(ctx, readModalFields(interaction), customId);
    } catch (err) {
      console.error(`[slash-modal:${customId}]`, err);
      return ctx.respond(`⚠ ${err.message || "Something went wrong."}`);
    }

    if (! ctx._responded) {
      await ctx.respond("Done.");
    }
  }

  bot.on("interactionCreate", (interaction) => {
    let promise;
    if (interaction.type === InteractionTypes.APPLICATION_COMMAND) {
      promise = dispatchCommand(interaction);
    } else if (interaction.type === InteractionTypes.APPLICATION_COMMAND_AUTOCOMPLETE) {
      promise = dispatchAutocomplete(interaction);
    } else if (interaction.type === InteractionTypes.MODAL_SUBMIT) {
      promise = dispatchModal(interaction);
    } else {
      return;
    }
    // The returned promise is awaited by tests; in production Eris ignores it. The catch keeps a
    // failed dispatch from surfacing as an unhandled rejection.
    return promise.catch(err => console.error("[slash] interaction error:", err));
  });

  return {
    addCommand,
    addThreadCommand,
    addInboxCommand,
    addGlobalCommand,
    addModalHandler,
    buildPayload,
    registerCommands,
  };
}

module.exports = { createSlashCommandManager };
