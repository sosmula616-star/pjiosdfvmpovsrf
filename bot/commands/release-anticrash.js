const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db = require('../../database/db');
const { sendLog } = require('../services/logService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('release-anticrash')
    .setDescription('Выпустить участника из антикраша/карантина (ТОЛЬКО ДЛЯ ВЛАДЕЛЬЦА СЕРВЕРА)')
    .addUserOption(option =>
      option.setName('target')
        .setDescription('Участник, с которого нужно снять санкции антикраша')
        .setRequired(false)
    )
    .addStringOption(option =>
      option.setName('user_id')
        .setDescription('ID пользователя (если он был забанен или отсутствует на сервере)')
        .setRequired(false)
    )
    .addStringOption(option =>
      option.setName('reason')
        .setDescription('Причина снятия санкций')
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const guild = interaction.guild;

    // 1. СТРОГАЯ ПРОВЕРКА: ТОЛЬКО ВЛАДЕЛЕЦ СЕРВЕРА
    if (interaction.user.id !== guild.ownerId) {
      return interaction.reply({
        content: `⛔ **Доступ категорически запрещен!**\nСнимать санкции антикраша и выпускать участников из карантина имеет право **только Владелец (Создатель) сервера** (<@${guild.ownerId}>).`,
        ephemeral: true
      });
    }

    const targetUser = interaction.options.getUser('target');
    const targetIdStr = interaction.options.getString('user_id');
    const reason = interaction.options.getString('reason') || 'Решение создателя сервера';

    const userId = targetUser ? targetUser.id : (targetIdStr ? targetIdStr.trim() : null);

    if (!userId) {
      return interaction.reply({
        content: '⚠️ Укажите пользователя через `@участник` или введите его цифровой `user_id`.',
        ephemeral: true
      });
    }

    await interaction.deferReply();

    // 2. Поиск активной записи в базе данных
    const activeOffenders = db.getAntiCrashUsers(guild.id).filter(u => u.userId === userId && u.status === 'active');
    const record = activeOffenders[0];

    const settings = db.getGuildSettings(guild.id);
    let member = null;
    try {
      member = await guild.members.fetch(userId).catch(() => null);
    } catch (e) {}

    let unbanned = false;
    let rolesRestoredCount = 0;
    let banRoleRemoved = false;

    // 3. Если участник был забанен сервером — снимаем бан в Discord
    try {
      const bans = await guild.bans.fetch().catch(() => null);
      if (bans && bans.has(userId)) {
        await guild.members.unban(userId, `Антикраш: Снятие санкций владельцем ${interaction.user.tag}`).catch(() => {});
        unbanned = true;
      }
    } catch (e) {}

    // 4. Если участник на сервере — снимаем роль бана/карантина и возвращаем роли
    if (member) {
      const banRoleId = settings.specialRoles?.banRoleId;
      if (banRoleId && member.roles.cache.has(banRoleId)) {
        await member.roles.remove(banRoleId, 'Антикраш: Снятие роли бана создателем сервера').catch(() => {});
        banRoleRemoved = true;
      }

      // Восстановление снятых ранее ролей
      if (record && record.strippedRoleIds && record.strippedRoleIds.length > 0) {
        for (const rId of record.strippedRoleIds) {
          const role = guild.roles.cache.get(rId);
          if (role && role.editable && !member.roles.cache.has(rId)) {
            await member.roles.add(role, 'Антикраш: Восстановление ролей владельцем').catch(() => {});
            rolesRestoredCount++;
          }
        }
      }
    }

    // 5. Обновляем статус в базе данных (PostgreSQL)
    const releasedRecord = db.releaseAntiCrashUser(guild.id, userId, `${interaction.user.tag} (Владелец сервера)`);

    // 6. Аудит лог
    await sendLog(guild, {
      category: 'anticrash',
      action: 'OFFENDER_RELEASED_BY_OWNER',
      title: '👑 Владелец сервера выпустил участника из антикраша',
      description: `Создатель сервера **${interaction.user.tag}** снял все ограничения антикраша с пользователя <@${userId}> (\`${userId}\`).`,
      executor: interaction.user,
      fields: [
        { name: 'Причина', value: reason, inline: true },
        { name: 'Разбан в Discord', value: unbanned ? '✅ Снят' : 'Не требовался', inline: true },
        { name: 'Ролей восстановлено', value: `${rolesRestoredCount}`, inline: true },
        { name: 'Статус в БД', value: '🟢 Снят с учета (released)', inline: true }
      ],
      color: 0x2ECC71
    });

    const embed = new EmbedBuilder()
      .setColor(0x2ECC71)
      .setTitle('👑 Санкции антикраша успешно сняты!')
      .setDescription(
        `Пользователь <@${userId}> (\`${userId}\`) успешно освобожден из карантина антикраша по решению владельца сервера.\n\n` +
        `• **Инициатор:** ${interaction.user} *(Владелец сервера)*\n` +
        `• **Причина:** ${reason}\n` +
        `• **Разбан:** ${unbanned ? 'Да, блокировка снята' : 'Участник не был в бане'}\n` +
        `• **Роль бана/карантина:** ${banRoleRemoved ? 'Снята' : 'Отсутствовала'}\n` +
        `• **Восстановлено ролей:** ${rolesRestoredCount}\n` +
        `• **Запись в PostgreSQL:** Статус обновлен на \`released\` ✅`
      )
      .setFooter({ text: 'Система безопасности Musicium Staff' })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  }
};
