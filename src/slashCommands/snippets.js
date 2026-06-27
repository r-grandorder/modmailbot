const { parseArguments } = require("knub-command-manager");
const utils = require("../utils");
const snippetsData = require("../data/snippets");
const { ApplicationCommandOptionTypes: OPT } = require("eris").Constants;

// Slash equivalent of src/modules/snippets.js (snippet send replaces the !!name prefix invocation)
module.exports = (slash, { config }) => {
  if (! config.allowSnippets) return;

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
        return ctx.respondChunks(`**Snippets** (${triggers.length}): ${triggers.join(", ")}`);
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
};
