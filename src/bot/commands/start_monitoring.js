import { SlashCommandBuilder } from 'discord.js';
import { createBaseEmbed, sendErrorEmbed, sendWaitingEmbed } from '../components/base_embeds.js';
import crud from '../../crud.js';
import t from '../../t.js';
import Logger from '../../utils/logger.js';
import { validateVintedUrl } from '../../services/query_service.js';

export const data = new SlashCommandBuilder()
    .setName('start_monitoring')
    .setDescription('Start monitoring this Vinted channel.')
    .addStringOption(option =>
        option.setName('url')
            .setDescription('A Vinted catalog, category or brand page URL.')
            .setRequired(true))
    .addStringOption(option =>
        option.setName('keywords')
            .setDescription('Optional: words to find in the title or description (e.g. cuir noir)')
            .setMaxLength(100)
            .setRequired(false));

export async function execute(interaction) {
    const l = interaction.locale;
    await sendWaitingEmbed(interaction, t(l, 'starting-monitoring'));

    const url = interaction.options.getString('url');
    // Optional keywords: commas/semicolons count as spaces, all words must match.
    const keywords = (interaction.options.getString('keywords') ?? '')
        .replace(/[,;]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const discordId = interaction.user.id;
    const channelId = interaction.channel.id;

    let validation = validateVintedUrl(url);
    // A bare /catalog link is fine when keywords already narrow the search.
    if (validation === 'must-have-query-params' && keywords) validation = true;
    if (validation !== true) {
        await sendErrorEmbed(interaction, t(l, validation));
        return;
    }

    try {
        const user = await crud.getUserByDiscordId(discordId);
        if (!user) {
            await sendErrorEmbed(interaction, t(l, 'user-not-found'));
            return;
        }

        const vintedChannel = user.channels.find(channel => channel.channelId === channelId && channel.user.equals(user._id));
        if (!vintedChannel) {
            await sendErrorEmbed(interaction, t(l, 'channel-not-found-nor-owned'));
            return;
        }

        if (!url && !vintedChannel.url) {
            await sendErrorEmbed(interaction, t(l, 'provide-vaild-url') + " " + t(l, url));
            return;
        }

        const embed = await createBaseEmbed(
            interaction,
            t(l, 'monitoring-started'),
            t(l, 'monitoring-has-been-started', { url: url || vintedChannel.url}) +
                (keywords ? `\n🔎 Keywords: **${keywords}**` : ''),
            0x00FF00
        );

        await interaction.editReply({ embeds: [embed] });

        await crud.startVintedChannelMonitoring(vintedChannel._id, url, keywords);
    } catch (error) {
        console.error('Error starting monitoring session:', error);
        await sendErrorEmbed(interaction, 'There was an error starting the monitoring session.');
    }
}