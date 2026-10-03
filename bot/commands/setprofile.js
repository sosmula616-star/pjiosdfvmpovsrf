const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../../database/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setprofile')
    .setDescription('Настроить свой профиль: фон (баннер), статус или описание')
    .addStringOption(opt =>
      opt.setName('banner_url')
        .setDescription('Прямая ссылка на картинку для фона карточки (баннера)')
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('bio')
        .setDescription('Короткий текст о себе (до 200 символов)')
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('title')
        .setDescription('Ваш кастомный титул (например: Битмейкер, DJ, Меломан)')
        .setRequired(false)
    ),

  async execute(interaction) {
    const bannerUrl = interaction.options.getString('banner_url');
    const bio = interaction.options.getString('bio');
    const customTitle = interaction.options.getString('title');

    const updates = {};
    if (bannerUrl) {
      if (!bannerUrl.startsWith('http://') && !bannerUrl.startsWith('https://')) {
        return interaction.reply({ content: '❌ Ссылка на баннер должна начинаться с http:// или https://', ephemeral: true });
      }
      updates.bannerUrl = bannerUrl;
    }
    if (bio) updates.bio = bio;
    if (customTitle) updates.customTitle = customTitle;

    if (Object.keys(updates).length === 0) {
      return interaction.reply({ content: 'Укажите хотя бы один параметр для изменения (ссылку на баннер, описание или титул)!', ephemeral: true });
    }

    const updatedProfile = db.updateProfile(interaction.guild.id, interaction.user.id, updates);

    const embed = new EmbedBuilder()
      .setColor(0x10B981)
      .setTitle('✅ Профиль успешно обновлен!')
      .setDescription('Ваши новые данные сохранены и теперь отображаются в `/profile` и на веб-панели.')
      .setThumbnail(interaction.user.displayAvatarURL())
      .setImage(updatedProfile.bannerUrl)
      .addFields(
        { name: '🎖️ Титул', value: updatedProfile.customTitle || 'Слушатель', inline: true },
        { name: '📝 О себе', value: updatedProfile.bio || '—', inline: false }
      )
      .setTimestamp();

    return interaction.reply({ embeds: [embed], ephemeral: true });
  }
};
