import { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v9';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Logger from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const commands = [];
const commandFiles = fs.readdirSync(path.join(__dirname, 'commands')).filter(file => file.endsWith('.js'));

async function loadCommands() {
    for (const file of commandFiles) {
        const module = await import(`./commands/${file}`);
        commands.push(module.data.toJSON());
    }
}

export async function registerCommands(client, discordConfig) {
    await loadCommands();
    const rest = new REST({ version: '10' }).setToken(discordConfig.token);
    try {
        Logger.info('Started refreshing application (/) commands.');
        await rest.put(
            Routes.applicationCommands(discordConfig.client_id),
            { body: commands }
        );
        Logger.info('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error('Error reloading commands:', error);
    }
}

export async function handleCommands(interaction) {
    if (!interaction.isCommand()) return;

    Logger.info(`Received command: ${interaction.commandName}`);

    try {   
        const module = await import(`./commands/${interaction.commandName}.js`);
        await module.execute(interaction);
    } catch (error) {
        Logger.error('Error handling command:', error);
        const payload = { content: 'There was an error while executing this command!', ephemeral: true };
        try {
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp(payload);
            } else {
                await interaction.reply(payload);
            }
        } catch (followUpError) {
            Logger.debug(`Could not notify user of command error: ${followUpError?.message || followUpError}`);
        }
    }
}
