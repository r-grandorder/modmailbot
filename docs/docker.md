# 🐳 Running with Docker

A prebuilt image is published to the GitHub Container Registry on every push to `master`:
`ghcr.io/r-grandorder/modmailbot`. This lets you run the bot without cloning the repo or installing Node.

Tags:
* `latest` - newest build on `master`
* `sha-<short>` - immutable, pin to an exact commit
* `3.10.0` / `3.10` - published on `v*` release tags

## Prerequisites
Go through the normal [setup](setup.md) first to create your `config.ini`. The image does **not** contain a `config.ini` or a database; you provide those at runtime.

## Run it
```bash
docker pull ghcr.io/r-grandorder/modmailbot:latest

docker run -d --name modmail --restart unless-stopped \
  -v "$(pwd)/config.ini:/usr/src/bot/config.ini:ro" \
  -v "$(pwd)/db:/usr/src/bot/db" \
  -v "$(pwd)/attachments:/usr/src/bot/attachments" \
  ghcr.io/r-grandorder/modmailbot:latest
```
The bot's working directory in the image is `/usr/src/bot`. You run this once; with `--restart unless-stopped` the container stays up across crashes and reboots. To update, `docker pull` the new image and recreate the container.

Which mounts you actually need depends on your config:

| Mount | When you need it |
|---|---|
| `config.ini` (read-only) | Always. The bot won't start without it. Its contents are identical to a normal setup. |
| `db/` | Only with the default `sqlite` database (holds thread history, logs, blocks, snippets, notes). With `dbType = mysql`, your data lives in MySQL and this mount isn't needed. |
| `attachments/` | Only with `attachmentStorage = local`. |

> A `docker-compose.yml` isn't included yet, but one can be added if there's interest, so the mounts live in a file instead of the run command.

## Migrating from a self-built image
If you currently build the image yourself and your `config.ini` / database / attachments were baked into the image or lived inside the container (no volumes), copy them out to the host first, then mount them as above:
```bash
docker cp old-modmail:/usr/src/bot/config.ini ./config.ini
docker cp old-modmail:/usr/src/bot/db ./db
cp ./db/data.sqlite ./db/data.sqlite.bak   # back up before the first run; DB migrations run on startup
```
After that, updating is just `docker pull` instead of rebuilding.
