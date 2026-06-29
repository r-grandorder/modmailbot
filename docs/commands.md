# 🤖 Commands

Staff actions are Discord **slash commands**. Type `/` in a channel on the inbox server to browse them. The bot's confirmation back to you is ephemeral (only you see it); the reply itself is posted into the thread and delivered to the user's DMs.

> The bot must be invited with the `applications.commands` scope for these to appear. See [🛠️ Setup](setup.md).

Commands that take a `user` accept the member picker, and you can paste a raw user ID into it to target someone who is not in the server (this does not ping them). When run inside a thread, those commands default to that thread's user.

## Table of contents
* [Replying](#replying)
* [Managing a thread](#managing-a-thread)
* [Users, logs, and blocking](#users-logs-and-blocking)
* [Other](#other)
* [Snippets (canned messages)](#snippets-canned-messages)

## Replying
Used inside a Modmail thread's channel.

### `/reply message:<text> [attachment]`
Send a reply to the user. Optionally attach one file.

### `/anonreply message:<text> [attachment]`
Send an anonymous reply. Anonymous replies only show the moderator's role, not the name.

### `/realreply message:<text> [attachment]`
Send a reply that always includes your name and role, even if the `forceAnon` option is enabled.

### `/edit number:<n> text:<text>`
Edit one of your own previous replies. `<n>` is the message number shown in front of staff replies. Requires `allowStaffEdit`.

### `/delete number:<n>`
Delete one of your own previous replies. Requires `allowStaffDelete`.

## Managing a thread
Used inside a Modmail thread's channel.

### `/close [time] [silent] [cancel]`
Close the thread. An immediate close opens a short dialog where you can save a closing **note** to the log before the channel is gone (channel chatter is not logged, so this is where you record any context worth keeping). The note is optional.
* `time:` close after a delay, e.g. `time:15m`. A message to or from the user cancels a scheduled close. Scheduled closes skip the note dialog.
* `silent:true` close without notifying the user.
* `cancel:true` cancel a scheduled close.

### `/suspend [time] [cancel]`
Suspend the thread. It acts as closed and receives no messages until `/unsuspend`. `time:` to schedule, `cancel:true` to cancel a scheduled suspend. Requires `allowSuspend`.

### `/unsuspend`
Unsuspend the thread.

### `/move category:<name>`
Move the thread to a different category. Requires `allowMove`.

### `/alert [cancel]`
Ping you when the thread gets a new reply. `cancel:true` to stop.

### `/id`
Show the user's ID.

### `/message number:<n>`
Show the DM channel ID, DM message ID, and message link for the specified reply. `<n>` is the message number shown in front of staff replies.

### `/role show | set role:<role> | reset`
Manage the role shown in front of your name in replies. Inside a thread these act on your per-thread role; outside a thread they act on your default role. `set` only accepts a role you currently have. Requires `allowChangingDisplayRole`.

## Users, logs, and blocking
These work inside a thread (defaulting to that user) or anywhere on the inbox server with a `user:`.

### `/logs [user] [page] [verbose] [simple]`
List previous Modmail logs with a user. `verbose:` and `simple:` adjust the log link.

### `/log [thread_number] [verbose] [simple]`
Show the log for a specific thread (by number or ID), or the current thread if omitted. Replaces the old `!log` and `!loglink`.

### `/block [user] [duration]`
Block a user from Modmail. `duration:` for a timed block, e.g. `duration:7d`. Requires `allowBlock`.

### `/unblock [user] [duration]`
Unblock a user, or schedule an unblock with `duration:`. Requires `allowBlock`.

### `/is_blocked [user]`
Check whether a user is blocked. Requires `allowBlock`.

### `/note add text:<text> [user]`
Add a staff note about a user. Requires `allowNotes`.

### `/note list [user]`
Show all notes about a user.

### `/note delete id:<id>`
Delete a note by its ID (shown in `/note list`).

### `/newthread user:<user>`
Open a Modmail thread with a user.

## Other

### `/version`
Show the Modmail bot's version.

## Snippets (canned messages)
See the [📋 Snippets](snippets.md) page.
