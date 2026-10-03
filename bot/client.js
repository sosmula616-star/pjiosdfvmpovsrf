const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { registerAntiCrashEvents } = require('./events/antiCrashEvents');
const { registerLoggingEvents } = require('./events/loggingEvents');
const { registerProfileEvents } = require('./events/profileEvents');

function createBotClient() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildModeration,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMessageReactions
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.GuildMember, Partials.User]
  });

  client.commands = new Collection();

  // Load standard event files
  const readyEvent = require('./events/ready');
  client.once('ready', () => readyEvent.execute(client));

  const interactionEvent = require('./events/interactionCreate');
  client.on('interactionCreate', (interaction) => interactionEvent.execute(interaction, client));

  // Load Anti-Crash, Logging & Profile event handlers
  registerAntiCrashEvents(client);
  registerLoggingEvents(client);
  registerProfileEvents(client);

  return client;
}

module.exports = {
  createBotClient
};
