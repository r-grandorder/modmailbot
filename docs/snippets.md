# 📋 Snippets
Snippets, sometimes called "canned messages" or "tags", are commonly used messages you can send in a Modmail thread with one command.

Everything is a subcommand of `/snippet`. When a command takes a snippet `name`, start typing and it autocompletes from your existing snippets. Requires `allowSnippets`.

## Sending a snippet
### `/snippet send name:<shortcut> [args] [anon]`
Inside a Modmail thread, send a snippet to the user (this replaces the old `!!shortcut` syntax).
* `args:` fills the snippet's `{1}`, `{2}`, ... placeholders, in order, separated by spaces.
* `anon:true` sends it anonymously (only your role is shown).

#### Example
To send a snippet called `hi`: `/snippet send name:hi`

## Viewing snippets
### `/snippet list`
List all snippet names.

### `/snippet show name:<shortcut>`
Show a specific snippet's text.

## Creating a snippet
### `/snippet add name:<shortcut> text:<text>`

#### Example
To create a snippet called `hi` with the text "Hello, how can we help you?":

`/snippet add name:hi text:Hello, how can we help you?`

## Editing a snippet
### `/snippet edit name:<shortcut> text:<text>`

#### Example
To change the `hi` snippet to "Hello, how are you?":

`/snippet edit name:hi text:Hello, how are you?`

## Deleting a snippet
### `/snippet delete name:<shortcut>`

#### Example
To delete the `hi` snippet:

`/snippet delete name:hi`
