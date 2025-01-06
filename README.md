# Botshi

A Twitch and Discord bot with utilities for mods and editors.

## Twitch
* `!vip <username>` Add user as a vip. Only moderators can use this.
* `!unvip <username> ` Remove user as a vip. Only moderators can use this.
* `!tag <message>` Add a tag at the current time for the stream.

## Discord
* `/tagstwitch` Retrieve tags for a given vod id in a format that links to twitch with `?t=timestamp`
* `/tagssrt` Retrieve tags for a given vod id in SRT format. For use with premiere, davinci, capcut, etc.
* Prevent people from pinging certain roles in both @ mentions and @ replies. See `TARGET_USER_ROLES`
* Allow people from pinging those roles only in `WHITELISTED_CHANNELS`
* Allow some roles to ping the target roles (ie mods) with `ALLOWED_ROLE_IDS`
* Send mod messages to `MOD_CHANNEL_ID`

# Quickstart
## Environment
You must fill the required environment file `.env` with the following data of your own bots and channels:
```
DISCORD_TOKEN= #string
DISCORD_CLIENT_ID= #string
TARGET_USER_ROLES= #comma separated strings
WHITELISTED_CHANNELS= #comma separated strings
ALLOWED_ROLE_IDS= #comma separated strings
MOD_CHANNEL_ID= #string
TWITCH_CLIENT_ID= #string
TWITCH_CLIENT_SECRET= #string
TWITCH_BROADCASTER=mainoboshi #string
TWITCH_GLOBAL_DELAY=15 #int in seconds
DOMAIN= #string
```
For twitch you must authenticate as the broadcaster in order to have access to broadcoaster only commands such as vip.

## OAuth
Your server must be able to authenticate through oauth. Go to your server address `https://domain.com/auth` to initiate the oauth request.
It will be given back to the bot on `https://domain.com/auth/callback`
I use express on this app with an ngnix reverse proxy.

## Warning
You should probably not use this in production. Currently, everything is saved locally in json files instead of a proper DB.
