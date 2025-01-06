import { Attachment, AttachmentBuilder, ChatInputCommandInteraction, Message, SlashCommandBuilder } from "discord.js";
import { getTimeDifference, getTwitchVodFromId, loadStream } from "..";
import { TagCommands } from "twitch-js";

export const data = new SlashCommandBuilder()
    .setName("tagssrt")
    .setDescription("Obtener tags en formato SRT")
    .addStringOption(option =>
        option.setName('vodid')
            .setDescription('el id del vod del que quieres tags')
            .setRequired(true)
    );

export async function execute(interaction: ChatInputCommandInteraction) {

    const vodid = interaction.options.getString('vodid', true)

    if (!vodid) {
        return interaction.reply("Tienes que incluir el id del vod!");
    }

    const vod = await getTwitchVodFromId(vodid)

    if (!vod) {
        return interaction.reply("Ese vod no existe");
    }

    console.log(`Se encontró el vod ${vodid} buscando tags...`)

    if (!vod.streamId) {
        console.error(`El vod no tiene un stream ${vod.id} ${vod.streamId}`)
        return interaction.reply("Ese vod no pertenece a un stream.");
    }

    console.log(`buscando tags del stream ${vod.streamId}`)

    const stream = await loadStream(vod.streamId);

    if (!stream) {
        console.log(`${vod}`)
        return interaction.reply("No se encontraron tags para ese vod.");
    }

    console.log(`transformando ${stream.tags.length} tags`)

    if (stream.tags.length === 0) {
        console.log(`Stream had no tags`)
        return interaction.reply("El stream no tiene tags.")
    }

    const mappedTags = stream.tags.map((tag, index) => {
        if (!tag.relativeTimestamp) {
            tag.relativeTimestamp = getTimeDifference(tag.timestamp, stream.startTime, 0)
        }
        return `${index + 1}\n${formatRelativeTimeWithPadding(tag.relativeTimestamp)},000 --> ${formatRelativeTimeWithPadding(tag.relativeTimestamp + 15000)},000\n${tag.message}\n\n`
    })

    const srt = new AttachmentBuilder(Buffer.from(`${mappedTags}`, 'utf-8'), { name: 'tags.srt' })

    return interaction.reply({
        files: [srt]
    });
}

function formatRelativeTimeWithPadding(timeDiffMs: number): string {
    const hours = Math.floor(timeDiffMs / 3600000);
    const minutes = Math.floor((timeDiffMs % 3600000) / 60000);
    const seconds = Math.floor((timeDiffMs % 60000) / 1000);

    // Format as 00:00:00 for SRT timestamp
    const hoursStr = hours.toString().padStart(2, "0")
    const minutesStr = minutes.toString().padStart(2, "0")
    const secondsStr = seconds.toString().padStart(2, "0")

    return `${hoursStr}:${minutesStr}:${secondsStr}`;
}