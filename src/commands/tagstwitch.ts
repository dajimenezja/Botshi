import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { getTwitchVodFromId, loadStream } from "..";

export const data = new SlashCommandBuilder()
    .setName("tagstwitch")
    .setDescription("Obtener tags en formato twitch")
    .addStringOption(option =>
        option.setName('vodid')
            .setDescription('el id del vod del que quieres tags')
            .setRequired(true)
    );

export async function execute(interaction: ChatInputCommandInteraction) {
    
    const vodid = interaction.options.getString('vodid', true) 

    if (!vodid){
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

    const mappedTags = stream.tags.map((tag, index) =>
        `${index + 1} - [\`${tag.relativeTime}\`](<${vod.url}?t=${tag.relativeTime}>) : ${tag.message}\n`
    )


    return interaction.reply(`Tags del stream (${stream.tags.length}):\n > ${mappedTags}`);
}