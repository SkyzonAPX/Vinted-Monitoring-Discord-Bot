import { SlashCommandBuilder } from 'discord.js';
import { createBaseEmbed, sendErrorEmbed, sendWaitingEmbed } from '../components/base_embeds.js';
import crud from '../../crud.js';
import t from '../../t.js';

export const data = new SlashCommandBuilder()
    .setName('delete_private_channel')
    .setDescription('Delete a private monitoring channel.')
    .addStringOption(option =>
        option.setName('channel_id')
            .setDescription('The ID of the channel to be deleted.')
            .setRequired(true));


export async function execute(interaction) {
    try {
        const l = interaction.locale;
        await sendWaitingEmbed(interaction, t(l, 'deleting-private-channel'));

        const channelId = interaction.options.getString('channel_id');
        const discordId = interaction.user.id;

        let user = await crud.getUserByDiscordId(discordId);
        if (!user) {
            await sendErrorEmbed(interaction, t(l, 'user-not-found'));
            return;
        }

        const vintedChannel = await crud.isUserOwnerOfChannel(user.channels, channelId, discordId);
        if (!vintedChannel) {
            await sendErrorEmbed(interaction, t(l, 'channel-not-found'));
            return;
        }

        await crud.deleteVintedChannel(vintedChannel._id);
        await crud.removeChannelFromUser(user._id, vintedChannel._id);

        const discordChannel = interaction.guild.channels.cache.get(vintedChannel.channelId);
        if (discordChannel) {
            await discordChannel.delete();
        }

        const embed = await createBaseEmbed(
            interaction,
            t(l, 'private-channel-deleted'),
            t(l, 'private-channel-deleted-success', { channelId }),
            0xFF0000
        );

        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        console.error('Error deleting private channel:', error);
        await sendErrorEmbed(interaction, 'There was an error deleting the private channel.');
    }
}
