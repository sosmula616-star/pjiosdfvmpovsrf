const { REST, Routes, ActivityType } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { startExpirationScheduler } = require('../services/modService');
const { startDailyChannelGuard } = require('../services/serverSetupService');

module.exports = {
  name: 'ready',
  once: true,
  async execute(client) {
    console.log(`[Bot] Logged in as ${client.user.tag} (ID: ${client.user.id})`);

    // Set bot presence
    client.user.setPresence({
      activities: [{ name: '🛡️ Защита Musicium | /help', type: ActivityType.Custom }],
      status: 'online'
    });

    // Load commands for Slash Command registration
    const commands = [];
    const commandsPath = path.join(__dirname, '..', 'commands');
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

    for (const file of commandFiles) {
      const command = require(path.join(commandsPath, file));
      if (command.data) {
        commands.push(command.data.toJSON());
        client.commands.set(command.data.name, command);
      }
    }

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

    try {
      console.log(`[Bot] Refreshing ${commands.length} application (/) commands...`);

      // If GUILD_ID is specified, register quickly for that guild, otherwise globally
      if (process.env.GUILD_ID) {
        await rest.put(
          Routes.applicationGuildCommands(client.user.id, process.env.GUILD_ID),
          { body: commands }
        );
        console.log(`[Bot] Successfully registered slash commands for guild ${process.env.GUILD_ID}`);
      } else {
        await rest.put(
          Routes.applicationCommands(client.user.id),
          { body: commands }
        );
        console.log('[Bot] Successfully registered slash commands globally.');
      }
    } catch (error) {
      console.error('[Bot] Error registering slash commands:', error);
    }

    // Start background scheduler for auto-unban and auto-unmute
    startExpirationScheduler(client);
    // Start daily channel integrity checker
    startDailyChannelGuard(client);
  }
};
