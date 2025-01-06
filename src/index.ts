import { Client, Colors, EmbedBuilder, Events, GuildChannel, Message, TextChannel } from "discord.js";
import { deployCommands } from "./deploy-commands";
import { commands } from "./commands";
import { config } from "./config";
import { ApiClient, HelixVideo, UserIdResolvable } from '@twurple/api';
import { EventSubWsListener } from '@twurple/eventsub-ws';
import { Bot, createBotCommand } from '@twurple/easy-bot';
import { AccessToken, RefreshingAuthProvider, exchangeCode } from '@twurple/auth';
import express from 'express';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';

dotenv.config();

interface StreamTag {
    timestamp: Date;
    relativeTime: string;
    relativeTimestamp: number;
    moderator: string;
    message: string;
}

class Stream {
    id: string;
    startTime: Date;
    delay: number;
    vodDelay: number;
    tags: StreamTag[];

    constructor(id: string, startTime: Date, delay: number = 10, vodDelay: number = 0, tags: StreamTag[] = []) {
        this.id = id;
        this.startTime = startTime;
        this.delay = delay;
        this.vodDelay = delay;
        this.tags = tags
    }
}

const globalDelay = Number.parseInt(config.TWITCH_GLOBAL_DELAY ?? "0")

async function saveStream(stream: Stream) {
    try {
        fs.writeFile(`./tags.${stream.id}.json`, JSON.stringify(stream, null, 4), 'utf-8');
    } catch (error) {
        warnError(error)
    }
}

export async function loadStream(id: string): Promise<Stream | null> {
    try {
        const stream = JSON.parse(await fs.readFile(`./tags.${id}.json`, 'utf-8'));
        return stream;
    } catch (error) {
        return null
    }
}

async function getStoredStreamOrNew(id: string, startDate: Date): Promise<Stream> {
    const storedStream = await loadStream(id);
    if (storedStream) {
        console.log(`Loaded stream ${storedStream.id} from cache with ${storedStream.tags.length} tags`);
        return storedStream
    }
    console.log(`Started a new stream with id ${id}`);
    return new Stream(id, startDate, globalDelay, 0, []);
}

class TwitchBot {
    private bot: Bot | null = null;
    private apiClient: ApiClient | null = null;
    private eventListener: EventSubWsListener | null = null;
    private authProvider: RefreshingAuthProvider | null = null;
    private app: express.Application;
    private readonly TOKEN_PATH = path.join(__dirname, 'tokens.json');
    private broadcaster: UserIdResolvable | null = null;
    private stream: Stream | null = null;

    constructor() {
        this.app = express();
        this.setupOAuth();
    }

    private setupOAuth() {
        this.app.get('/auth/callback', async (req, res) => {
            const code = req.query.code as string;

            if (!code) {
                res.status(400).send('Missing authorization code');
                return;
            }

            try {
                const tokenData = await exchangeCode(
                    process.env.TWITCH_CLIENT_ID!,
                    process.env.TWITCH_CLIENT_SECRET!,
                    code,
                    'https://aidle.moe/auth/callback'
                );

                await this.saveTokens(tokenData);
                await this.initializeBot();

                res.send('Authentication successful! You can close this window.');
            } catch (error) {
                console.error('Error during authentication:', error);
                res.status(500).send('Authentication failed');
            }
        });

        this.app.get('/auth', (_req, res) => {
            const scopes = ['chat:read', 'chat:edit', 'channel:manage:vips', 'channel:manage:broadcast'];
            const authUrl = `https://id.twitch.tv/oauth2/authorize?client_id=${process.env.TWITCH_CLIENT_ID}&redirect_uri=https://aidle.moe/auth/callback&response_type=code&scope=${scopes.join('+')}`;
            res.redirect(authUrl);
        });
    }

    private async saveTokens(tokenData: AccessToken): Promise<void> {
        try {
            await fs.writeFile(this.TOKEN_PATH, JSON.stringify(tokenData, null, 2));
            console.log('Tokens saved successfully');
        } catch (error) {
            console.error('Error saving tokens:', error);
            throw error;
        }
    }

    private async loadTokens(): Promise<AccessToken | null> {
        try {
            const data = await fs.readFile(this.TOKEN_PATH, 'utf-8');
            return JSON.parse(data);
        } catch (error) {
            console.log('No saved tokens found');
            return null;
        }
    }

    private async initializeBot() {
        const tokenData = await this.loadTokens();

        if (!tokenData) {
            console.log('No tokens found. Please authenticate first.');
            return;
        }

        this.authProvider = new RefreshingAuthProvider({
            clientId: process.env.TWITCH_CLIENT_ID!,
            clientSecret: process.env.TWITCH_CLIENT_SECRET!
        });

        this.authProvider.onRefresh(
            async (userId, newTokenData) => {
                await this.saveTokens(newTokenData);
            }
        )

        await this.authProvider.addUserForToken(tokenData, ['chat']);

        this.apiClient = new ApiClient({ authProvider: this.authProvider });
        this.eventListener = new EventSubWsListener({ apiClient: this.apiClient });

        try {
            const currentStream = await this.apiClient.streams.getStreamByUserName(config.TWITCH_BROADCASTER)
            if (currentStream) {
                console.log(`Stream ${currentStream.id} in progress started on ${currentStream?.startDate}`)
                this.stream = await getStoredStreamOrNew(currentStream.id, currentStream.startDate)
            } else {
                console.log(`Stream is not online`);
            }
        } catch (error) {
            warnError(error)
        }

        const modError = 'Solo los moderadores pueden usar este comando.';

        this.bot = new Bot({
            authProvider: this.authProvider,
            channels: [config.TWITCH_BROADCASTER],
            commands: [
                createBotCommand('tag', async (params, { reply, msg }) => {

                    if (!this.stream) {
                        warnError(new Error("New tag attempted but there is no stream"))
                        reply("Error: No hay stream")
                        return;
                    }

                    const now = new Date();
                    const timeDiff = getTimeDifference(now, this.stream.startTime, globalDelay)
                    const relativeTime = formatRelativeTime(timeDiff);

                    const tag: StreamTag = {
                        timestamp: now,
                        relativeTime,
                        relativeTimestamp: timeDiff,
                        moderator: msg.userInfo.userName,
                        message: `${params.join(' ')}`
                    };

                    this.stream.tags.push(tag);

                    saveStream(this.stream)

                    reply(`Se ha creado el tag en el minuto ${relativeTime}`);
                }),

                createBotCommand('vip', async (params, { reply, msg }) => {
                    const isModerator = msg.userInfo.isMod || msg.userInfo.isBroadcaster;

                    if (!isModerator) {
                        reply(modError);
                        return;
                    }

                    // Check if a username was provided
                    if (params.length === 0) {
                        reply('Especifica a quien hay que agregarle vip. Se usa asi: !vip nombre');
                        return;
                    }

                    if (!bot) {
                        console.error("Bot is null")
                    }

                    const username = params[0].replace('@', ''); // Remove @ if present

                    try {
                        // Add VIP status
                        await this.bot?.addVip(config.TWITCH_BROADCASTER, username);
                        reply(`Se le agregó VIP a @${username}!`);
                    } catch (error) {
                        // Handle specific error cases
                        if (error instanceof Error) {
                            if (error.message.includes('already VIP')) {
                                reply(`@${username} ya es VIP!`);
                            } else if (error.message.includes('not found')) {
                                reply(`El usuario @${username} no existe.`);
                            } else {
                                console.error('Error adding VIP:', error);
                                reply(`Error al agregarle VIP a @${username}. Revisa el nombre de usuario y vuelvelo a intentar.`);
                            }
                        }
                    }
                }),

                createBotCommand('unvip', async (params, { reply, msg }) => {
                    const isModerator = msg.userInfo.isMod || msg.userInfo.isBroadcaster;

                    if (!isModerator) {
                        reply(modError);
                        return;
                    }

                    // Check if a username was provided
                    if (params.length === 0) {
                        reply('Especifica a quien hay que quitarle vip. Se usa así: !unvip nombre');
                        return;
                    }

                    if (!bot) {
                        console.error("Bot is null")
                    }

                    const username = params[0].replace('@', ''); // Remove @ if present

                    try {
                        // Add VIP status
                        await this.bot?.removeVip(config.TWITCH_BROADCASTER, username);
                        reply(`Se le quitó VIP a @${username}!`);
                    } catch (error) {
                        // Handle specific error cases
                        if (error instanceof Error) {
                            if (error.message.includes('already VIP')) {
                                reply(`@${username} ya es VIP!`);
                            } else if (error.message.includes('not found')) {
                                reply(`El usuario @${username} no existe.`);
                            } else {
                                console.error('Error adding VIP:', error);
                                reply(`Error al quitarle VIP a @${username}. Revisa el nombre de usuario y vuelvelo a intentar.`);
                            }
                        }
                    }
                })
            ]
        })
        await this.setupEventSubscriptions();
    }

    private async setupEventSubscriptions() {
        if (!this.eventListener || !this.apiClient) return;

        try {
            this.broadcaster = await this.apiClient.users.getUserByName(config.TWITCH_BROADCASTER);
            if (!this.broadcaster) {
                throw new Error(`Could not find user ${config.TWITCH_BROADCASTER}`);
            }

            this.eventListener.onStreamOnline(this.broadcaster.id, event => {
                this.stream = new Stream(event.id, event.startDate, globalDelay, 0, [])
                try {
                    fs.writeFile(`./tags.${this.stream.id}.json`, JSON.stringify(this.stream, null, 4), 'utf-8');
                } catch (error) {
                    warnError(error)
                }
                console.log(`Stream started at ${this.stream.startTime}`);
            });

            this.eventListener.onStreamOffline(this.broadcaster.id, _event => {
                console.log(`Stream ended at ${new Date()}`);
                this.stream = null;
            });

            this.eventListener.start();
            console.log('Successfully subscribed to stream events');
        } catch (error) {
            console.error('Error setting up event subscriptions:', error);
        }
    }

    public async start(port: number = 3000) {
        await this.initializeBot();

        this.app.listen(port, () => {
            console.log(`Visit https://aidle.moe/auth to authenticate with Twitch`);
        });
    }

    public getTags(): StreamTag[] {
        return this.stream?.tags || [];
    }

    public getStreamStart(): Date | null {
        return this.stream?.startTime || null;
    }

    public async getVodVideoFromId(id: string): Promise<HelixVideo | null> {
        return await this.apiClient!.videos.getVideoById(id)
    }

    public getActiveStream(): Stream | null {
        return this.stream
    }
}

export function getTimeDifference(date1: Date, date2: Date, delay: number): number {
    return (new Date(date1).getTime()) - new Date(date2).getTime() - (delay * 1000);
}

export function formatRelativeTime(timeDiffMs: number): string {
    const hours = Math.floor(timeDiffMs / 3600000);
    const minutes = Math.floor((timeDiffMs % 3600000) / 60000);
    const seconds = Math.floor((timeDiffMs % 60000) / 1000);

    // Format as 0h:0m:0s for twitch timestamp
    const hoursStr = hours.toString()
    const minutesStr = minutes.toString()
    const secondsStr = seconds.toString()

    return `${hoursStr}h${minutesStr}m${secondsStr}s`;
}























// List of role IDs to monitor for mentions
const TARGET_USER_ROLES = (config.TARGET_USER_ROLES || '')
    .split(',')
    .map(id => id.trim())
    .filter(id => id); // Remove any empty strings

// Whitelist of channel IDs where mentions are allowed
const WHITELISTED_CHANNEL_IDS = (config.WHITELISTED_CHANNELS || '')
    .split(',')
    .map(id => id.trim())
    .filter(id => id); // Remove any empty strings

// Roles that are allowed to mention target users
const ALLOWED_ROLE_IDS = (config.ALLOWED_ROLE_IDS || '')
    .split(',')
    .map(id => id.trim())
    .filter(id => id); // Remove any empty strings

const MOD_CHANNEL = config.MOD_CHANNEL_ID || ""


const discordClient = new Client({
    intents: [
        "Guilds",
        "GuildMessages",
        "DirectMessages",
        "MessageContent"
    ]
});

var himieWasWarned: Boolean = false

discordClient.on(Events.GuildAvailable, async (guild) => {
    await deployCommands({ guildId: guild.id });
});

discordClient.on(Events.InteractionCreate, async (interaction) => {
    // console.log(interaction)
    if (!interaction.isChatInputCommand()) {
        console.log("Interaction is not a command")
        return;
    }
    console.log("Interaction is a command")
    const { commandName } = interaction;
    if (commands[commandName as keyof typeof commands]) {
        console.log("executing command")
        try {
            commands[commandName as keyof typeof commands].execute(interaction)
        } catch (error) {
            warnError(error)
        }
    } else {
        console.log("I have no idea what this is but you fucked up")
    }
});

discordClient.once("ready", async () => {
    console.log(`Logged in as ${discordClient.user?.tag}`);

    // Verify configuration
    if (TARGET_USER_ROLES.length === 0) {
        warnError('No TARGET_USER_ROLES set in the environment variables');
    }

    if (WHITELISTED_CHANNEL_IDS.length === 0) {
        console.warn('No whitelisted channels specified. The bot will not allow mentions anywhere.');
    }

    const guild = await discordClient.guilds.fetch('957359495154126848');
    const channels = guild.channels;
    const roles = guild.roles;

    const roleNames = ALLOWED_ROLE_IDS.map(id => roles.cache.get(id)?.name);
    const channelNames = WHITELISTED_CHANNEL_IDS.map(id => channels.cache.get(id)?.name);
    const targetRoles = TARGET_USER_ROLES.map(id => roles.cache.get(id)?.name);

    console.log('Target Roles:', targetRoles);
    console.log('Whitelisted Channels:', channelNames);
    console.log('Allowed Roles:', roleNames);
    console.log('Discord bot is ready!');
    console.log(`Twitch broadcaster target: ${config.TWITCH_BROADCASTER}`)
});

// Check if user has any of the allowed roles
function hasAllowedRole(message: Message): boolean {
    // If no roles are specified, default to no exceptions
    if (ALLOWED_ROLE_IDS.length === 0) return false;

    // Check if the message author has any of the allowed roles
    return message.member?.roles.cache.some(role =>
        ALLOWED_ROLE_IDS.includes(role.id)
    ) || false;
}

async function handleMaiMention(message: Message) {
    const isInWhitelistedChannel = WHITELISTED_CHANNEL_IDS.includes(message.channelId);
    const hasExemptRole = hasAllowedRole(message);

    if (!isInWhitelistedChannel && !hasExemptRole) {
        try {
            let isReply = false;
            if (message.reference && message.reference.messageId) {
                try {
                    const repliedMessage = await message.fetchReference();
                    isReply = repliedMessage.member?.roles.cache.some(role =>
                        TARGET_USER_ROLES.includes(role.id)
                    ) || false;
                } catch (error) {
                    warnError(error);
                }
            }

            const author = message.author
            const warningMessageDescription = isReply ?
                `Las reglas dicen que no puedes taggearme a mi o a mis amigas vtubers. ¡Quita el tag antes de responder y no me hagas @!` :
                `¡Las reglas dicen que no puedes hacerme @!`
            const warningEmbed = new EmbedBuilder()
                .setColor(Colors.Red)
                .setTitle('¡No me menciones!')
                .setDescription(warningMessageDescription)
                .setFooter({ text: 'Mensaje borrado' })
                .setImage(isReply ? 'https://i.imgur.com/lhJDl0w.png' : null)
                .setAuthor({ name: author.displayName, iconURL: author.displayAvatarURL() })

            // Send warning message
            const warningMessage = await message.reply({
                embeds: [warningEmbed],
                allowedMentions: { repliedUser: true } // Mention the user in the warning
            });

            const testChannel = await discordClient.channels.fetch('998102501360422992') as TextChannel

            const embed = new EmbedBuilder()
                .setAuthor({ name: message.author.displayName, iconURL: message.author.displayAvatarURL() })
                .setTitle(`Boshito ${message.author.displayName} intentó mencionar a Mai ${message.url}`)
                .setDescription(message.toString())
                .setColor(Colors.Red)

            await testChannel.send({
                embeds: [embed],
            });

            // Delete the original message
            await message.delete();
            console.log(`Deleted a message ${isReply ? 'replying to' : 'mentioning'} a target user from ${message.author.tag} in non-whitelisted channel`);
        } catch (error) {
            warnError(error);
        }
    }
}

async function checkIfForbiddenMention(message: Message<boolean>) {
    const isMentioningTargetUsers = message.mentions.members?.some(member =>
        member.roles.cache.some(role =>
            TARGET_USER_ROLES.includes(role.id)
        )
    );

    if (isMentioningTargetUsers) {
        handleMaiMention(message);
    }
}

async function replyToDiscordCommand(message: Message) {
    if (message.toString().toLowerCase().trim() === '!discord') {
        message.reply({
            content: "https://discord.com/invite/gremionoboshi"
        });
    }
}

async function checkIfGuildCustomLinkIsInactive() {
    const guild = await discordClient.guilds.fetch('957359495154126848');
    const guildLink = guild.vanityURLCode

    if (guildLink === "gremionoboshi") {
        himieWasWarned = false;
        return;
    }

    if (!himieWasWarned) {
        try {
            console.log(`vanity url is: ${guildLink}`)
            const modChannel = await discordClient.channels.fetch(MOD_CHANNEL) as TextChannel

            await modChannel.send({
                content: "¡El link del gremio dejó de funcionar! \n ¡¡Arréglalo <@143419914147987456> berto!!"
            });
            himieWasWarned = true
        } catch (error) {
            warnError(error);
        }

    }
}

// Event listener for incoming messages
discordClient.on('messageCreate', async (message: Message) => {
    if (message.author.bot) return;

    const channel = <GuildChannel>message.channel
    const memberName = message.member?.nickname || message.member?.displayName

    checkIfForbiddenMention(message);
    replyToDiscordCommand(message);
    checkIfGuildCustomLinkIsInactive();

    console.log(`#${channel.name} <${memberName}>: ${message}`)

});

// Voice state update event
discordClient.on('voiceStateUpdate', async (oldState, newState) => {
    // Check if user has joined a voice channel
    // if (oldState.channel === null && newState.channel !== null) {
    if (newState.member?.id === '917845281800847410') {
        const testChannel = await discordClient.channels.fetch('1313915669435256935') as TextChannel
        await testChannel.send({
            content: `Joined voice channel ${newState?.channel?.url}`
        });
    } else {
        console.log(`Member that joined: ${newState.member}`)
    }
    // }
});

async function warnError(error: any) {
    console.error(error);
    try {
        const testChannel = await discordClient.channels.fetch('1313915669435256935') as TextChannel;

        const embed = new EmbedBuilder()
            .setTitle("An error has occurred")
            .setDescription(`${error}`)
            .setColor(Colors.Red)
        await testChannel.send({
            embeds: [embed],
        });
    } catch (error) {
        console.error(error);
    }
}


discordClient.login(config.DISCORD_TOKEN)
const bot = new TwitchBot();
bot.start();

export async function getTwitchVodFromId(id: string): Promise<HelixVideo | null> {
    try {
        const vodVideo = await bot.getVodVideoFromId(id)
        console.log(`Vod retrieved: ${vodVideo?.id}`)
        if (vodVideo) {
            console.log("returning video")
            return vodVideo
        }
    } catch (error) {
        warnError(error)
    }
    console.log(`failed to retrieve vod`)
    return null
}