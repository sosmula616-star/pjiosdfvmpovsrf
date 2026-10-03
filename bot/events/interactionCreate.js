const db = require('../../database/db');
const { sendLog } = require('../services/logService');

module.exports = {
  name: 'interactionCreate',
  async execute(interaction, client) {
    // 1. Handle Verification Button Click
    if (interaction.isButton()) {
      if (interaction.customId === 'verify_member') {
        const guild = interaction.guild;
        const member = interaction.member;

        const settings = db.getGuildSettings(guild.id);
        let verifiedRoleId = settings.specialRoles?.verifiedRoleId;

        let role = verifiedRoleId ? guild.roles.cache.get(verifiedRoleId) : null;
        if (!role) {
          role = guild.roles.cache.find(r => r.name.toLowerCase().includes('слушатель') || r.name.toLowerCase().includes('verified'));
        }

        if (!role) {
          return interaction.reply({
            content: '❌ Роль верификации не найдена на сервере! Обратитесь к администрации.',
            ephemeral: true
          });
        }

        if (member.roles.cache.has(role.id)) {
          return interaction.reply({
            content: 'ℹ️ Вы уже прошли верификацию ранее!',
            ephemeral: true
          });
        }

        try {
          await member.roles.add(role, 'Успешная верификация через кнопку');

          await sendLog(guild, {
            category: 'members',
            action: 'MEMBER_VERIFIED',
            title: 'Участник прошел верификацию',
            description: `Пользователь получил роль @${role.name} и доступ к каналам сообщества`,
            target: member.user,
            color: 0x2ECC71
          });

          return interaction.reply({
            content: `🎉 **Верификация успешно пройдена!**\nВам выдана роль **@${role.name}**. Все каналы сообщества Musicium теперь открыты для вас. Приятного общения и прослушивания музыки!`,
            ephemeral: true
          });
        } catch (err) {
          return interaction.reply({
            content: `❌ Не удалось выдать роль верификации (проверьте права бота): ${err.message}`,
            ephemeral: true
          });
        }
      }
      return;
    }

    // 2. Handle Chat Slash Commands
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) {
      console.warn(`[Command] Unknown command: ${interaction.commandName}`);
      return;
    }

    try {
      await command.execute(interaction, client);
    } catch (error) {
      console.error(`[Command Error] /${interaction.commandName}:`, error);
      const replyContent = { content: '❌ Произошла ошибка при выполнении этой команды!', ephemeral: true };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(replyContent).catch(() => {});
      } else {
        await interaction.reply(replyContent).catch(() => {});
      }
    }
  }
};
