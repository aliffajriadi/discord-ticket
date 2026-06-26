import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  TextChannel,
} from "discord.js";
import { errorEmbed, successEmbed } from "../lib/utils.js";
import { closeTicket, reopenTicket, deleteTicket } from "../lib/ticket.js";
import prisma from "../lib/prisma.js";

// ── /close ─────────────────────────────────────────────────────────────────
export const closeData = new SlashCommandBuilder()
  .setName("close")
  .setDescription("Tutup tiket ini (user & staff)");

export async function executeClose(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild || !interaction.member) {
    return interaction.reply({ embeds: [errorEmbed("Hanya bisa digunakan di server.")], ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  const ticket = await prisma.ticket.findFirst({
    where: { channelId: interaction.channelId, guildId: interaction.guild.id },
  });

  if (!ticket) {
    return interaction.editReply({ embeds: [errorEmbed("Command ini hanya bisa digunakan di dalam channel tiket.")] });
  }

  if (ticket.status !== "OPEN") {
    return interaction.editReply({ embeds: [errorEmbed("Tiket ini sudah ditutup.")] });
  }

  const member = await interaction.guild.members.fetch(interaction.user.id);
  const result = await closeTicket(interaction.guild, member, ticket.id);

  if (!result.success) {
    return interaction.editReply({ embeds: [errorEmbed(result.message)] });
  }

  return interaction.editReply({ embeds: [successEmbed(result.message)] });
}

// ── /reopen ────────────────────────────────────────────────────────────────
export const reopenData = new SlashCommandBuilder()
  .setName("reopen")
  .setDescription("Buka kembali tiket yang sudah ditutup (hanya staff)");

export async function executeReopen(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild || !interaction.member) {
    return interaction.reply({ embeds: [errorEmbed("Hanya bisa digunakan di server.")], ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  const ticket = await prisma.ticket.findFirst({
    where: { channelId: interaction.channelId, guildId: interaction.guild.id },
    include: { reason: true },
  });

  if (!ticket) {
    return interaction.editReply({ embeds: [errorEmbed("Command ini hanya bisa digunakan di dalam channel tiket.")] });
  }

  // Check staff permission
  const member = await interaction.guild.members.fetch(interaction.user.id);
  const isStaff =
    interaction.guild.ownerId === interaction.user.id ||
    member.roles.cache.has(ticket.reason.supportRoleId);

  const guildData = await prisma.guild.findUnique({ where: { id: interaction.guild.id } });
  const isAdmin = guildData?.setupRoleId ? member.roles.cache.has(guildData.setupRoleId) : false;

  if (!isStaff && !isAdmin) {
    return interaction.editReply({ embeds: [errorEmbed("Hanya **Staff** atau **Admin** yang dapat membuka kembali tiket.")] });
  }

  const result = await reopenTicket(interaction.guild, member, ticket.id);

  if (!result.success) {
    return interaction.editReply({ embeds: [errorEmbed(result.message)] });
  }

  return interaction.editReply({ embeds: [successEmbed(result.message)] });
}

// ── /delete ────────────────────────────────────────────────────────────────
export const deleteData = new SlashCommandBuilder()
  .setName("delete")
  .setDescription("Hapus tiket ini secara permanen (hanya staff/owner)");

export async function executeDelete(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild || !interaction.member) {
    return interaction.reply({ embeds: [errorEmbed("Hanya bisa digunakan di server.")], ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  const ticket = await prisma.ticket.findFirst({
    where: { channelId: interaction.channelId, guildId: interaction.guild.id },
    include: { reason: true },
  });

  if (!ticket) {
    return interaction.editReply({ embeds: [errorEmbed("Command ini hanya bisa digunakan di dalam channel tiket.")] });
  }

  // Check staff permission
  const member = await interaction.guild.members.fetch(interaction.user.id);
  const isStaff =
    interaction.guild.ownerId === interaction.user.id ||
    member.roles.cache.has(ticket.reason.supportRoleId);

  const guildData = await prisma.guild.findUnique({ where: { id: interaction.guild.id } });
  const isAdmin = guildData?.setupRoleId ? member.roles.cache.has(guildData.setupRoleId) : false;

  if (!isStaff && !isAdmin) {
    return interaction.editReply({ embeds: [errorEmbed("Hanya **Staff** atau **Admin** yang dapat menghapus tiket.")] });
  }

  const result = await deleteTicket(interaction.guild, member, ticket.id);

  // Channel is deleted, so we can't reply to the channel anymore
  if (!result.success) {
    return interaction.editReply({ embeds: [errorEmbed(result.message)] });
  }
}

// ── /add ───────────────────────────────────────────────────────────────────
export const addData = new SlashCommandBuilder()
  .setName("add")
  .setDescription("Tambahkan user ke tiket ini (hanya staff)")
  .addUserOption((opt) =>
    opt.setName("user").setDescription("User yang akan ditambahkan").setRequired(true)
  );

export async function executeAdd(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild) {
    return interaction.reply({ embeds: [errorEmbed("Hanya bisa digunakan di server.")], ephemeral: true });
  }

  const ticket = await prisma.ticket.findFirst({
    where: { channelId: interaction.channelId, guildId: interaction.guild.id },
    include: { reason: true },
  });

  if (!ticket) {
    return interaction.reply({ embeds: [errorEmbed("Command ini hanya bisa digunakan di dalam channel tiket.")], ephemeral: true });
  }

  const member = await interaction.guild.members.fetch(interaction.user.id);
  const guildData = await prisma.guild.findUnique({ where: { id: interaction.guild.id } });

  const isStaff =
    interaction.guild.ownerId === interaction.user.id ||
    member.roles.cache.has(ticket.reason.supportRoleId) ||
    (guildData?.setupRoleId ? member.roles.cache.has(guildData.setupRoleId) : false);

  if (!isStaff) {
    return interaction.reply({ embeds: [errorEmbed("Hanya **Staff** yang dapat menambahkan user ke tiket.")], ephemeral: true });
  }

  const targetUser = interaction.options.getUser("user", true);
  const channel = interaction.channel as TextChannel;

  await channel.permissionOverwrites.edit(targetUser.id, {
    ViewChannel: true,
    SendMessages: true,
    ReadMessageHistory: true,
  });

  return interaction.reply({
    embeds: [successEmbed(`${targetUser.toString()} berhasil ditambahkan ke tiket.`)],
  });
}

// ── /remove ────────────────────────────────────────────────────────────────
export const removeData = new SlashCommandBuilder()
  .setName("remove")
  .setDescription("Keluarkan user dari tiket ini (hanya staff)")
  .addUserOption((opt) =>
    opt.setName("user").setDescription("User yang akan dikeluarkan").setRequired(true)
  );

export async function executeRemove(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild) {
    return interaction.reply({ embeds: [errorEmbed("Hanya bisa digunakan di server.")], ephemeral: true });
  }

  const ticket = await prisma.ticket.findFirst({
    where: { channelId: interaction.channelId, guildId: interaction.guild.id },
    include: { reason: true },
  });

  if (!ticket) {
    return interaction.reply({ embeds: [errorEmbed("Command ini hanya bisa digunakan di dalam channel tiket.")], ephemeral: true });
  }

  const member = await interaction.guild.members.fetch(interaction.user.id);
  const guildData = await prisma.guild.findUnique({ where: { id: interaction.guild.id } });

  const isStaff =
    interaction.guild.ownerId === interaction.user.id ||
    member.roles.cache.has(ticket.reason.supportRoleId) ||
    (guildData?.setupRoleId ? member.roles.cache.has(guildData.setupRoleId) : false);

  if (!isStaff) {
    return interaction.reply({ embeds: [errorEmbed("Hanya **Staff** yang dapat mengeluarkan user dari tiket.")], ephemeral: true });
  }

  const targetUser = interaction.options.getUser("user", true);

  // Prevent removing ticket creator
  if (targetUser.id === ticket.creatorId) {
    return interaction.reply({ embeds: [errorEmbed("Tidak dapat mengeluarkan pembuat tiket.")], ephemeral: true });
  }

  const channel = interaction.channel as TextChannel;
  await channel.permissionOverwrites.delete(targetUser.id);

  return interaction.reply({
    embeds: [successEmbed(`${targetUser.toString()} berhasil dikeluarkan dari tiket.`)],
  });
}
