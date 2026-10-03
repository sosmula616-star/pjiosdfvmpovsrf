const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { setupCommunityServer } = require('../services/serverSetupService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup-server')
    .setDescription('Автоматически создать категории, RU & EN каналы, правила и журналы аудита')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply();

    try {
      interaction.editReply({
        content: '⚙️ Создание структуры каналов, категорий и настройка прав... Пожалуйста, подождите (это займет 5-15 секунд)...'
      });

      const result = await setupCommunityServer(interaction.guild, interaction.user);

      const embed = new EmbedBuilder()
        .setColor(0x00FF88)
        .setTitle('🎉 Сервер успешно настроен!')
        .setDescription(
          `Развернута готовая структура для сообщества **Musicium**:\n\n` +
          `• **Категории:**\n` +
          `  📌 Информация & Правила\n` +
          `  🇷🇺 Русскоязычное сообщество (чаты, треки, голосовые комнаты)\n` +
          `  🇬🇧 English Community (general, music sharing, lounges)\n` +
          `  🎫 Поддержка и баг-репорты\n` +
          `  🛡️ Персонал (Staff Only)\n` +
          `  📋 Журнал аудита (Все 6 категорий логов)\n\n` +
          `• **Опубликованы правила:** на русском и английском языках в канале \`#правила-rules\`\n` +
          `• **Опубликован гайд по боту:** в канале \`#о-боте-about-bot\`\n` +
          `• **Логи:** Все события уже подключены к выделенным каналам!`
        )
        .setFooter({ text: 'Вы можете настроить права ролей и лимиты антикраша на веб-панели!' })
        .setTimestamp();

      return interaction.editReply({ content: '', embeds: [embed] });
    } catch (err) {
      console.error(err);
      return interaction.editReply({ content: `❌ Произошла ошибка при настройке сервера: ${err.message}` });
    }
  }
};
