import { SlashCommandBuilder, ChatInputCommandInteraction, TextChannel } from "discord.js";
import { errorEmbed, successEmbed, isTicketStaff, ticketSupportRole } from "../lib/utils.js";
import { closeTicket, reopenTicket, deleteTicket, claimTicket } from "../lib/ticket.js";
import prisma from "../lib/prisma.js";
import { Command } from "../types.js";

async function ticketInChannel(interaction: ChatInputCommandInteraction<"cached">) {
  return prisma.ticket.findFirst({
    where: { channelId: interaction.channelId, guildId: interaction.guild.id, status: { not: "DELETED" } },
    include: { reason: true },
  });
}

/** Pembungkus umum: pastikan dipakai di server & di channel tiket. */
function ticketCommand(
  data: SlashCommandBuilder | ReturnType<SlashCommandBuilder["addUserOption"]>,
  run: (
    interaction: ChatInputCommandInteraction<"cached">,
    ticket: NonNullable<Awaited<ReturnType<typeof ticketInChannel>>>
  ) => Promise<unknown>
): Command {
  return {
    data,
    async execute(interaction) {
      if (!interaction.inCachedGuild()) {
        return interaction.reply({ embeds: [errorEmbed("Hanya bisa digunakan di server.")], ephemeral: true });
      }
      await interaction.deferReply({ ephemeral: true });
      const ticket = await ticketInChannel(interaction);
      if (!ticket) {
        return interaction.editReply({ embeds: [errorEmbed("Command ini hanya bisa digunakan di dalam channel tiket.")] });
      }
      return run(interaction, ticket);
    },
  };
}

const respond = (
  interaction: ChatInputCommandInteraction<"cached">,
  result: { success: boolean; message: string }
) => interaction.editReply({ embeds: [result.success ? successEmbed(result.message) : errorEmbed(result.message)] });

export const commands: Command[] = [
  ticketCommand(
    new SlashCommandBuilder().setName("close").setDescription("Tutup tiket ini (pembuat tiket & staff)"),
    async (i, t) => respond(i, await closeTicket(i.guild, i.member, t.id))
  ),
  ticketCommand(
    new SlashCommandBuilder().setName("reopen").setDescription("Buka kembali tiket yang sudah ditutup (staff)"),
    async (i, t) => respond(i, await reopenTicket(i.guild, i.member, t.id))
  ),
  ticketCommand(
    new SlashCommandBuilder().setName("claim").setDescription("Klaim tiket ini untuk kamu tangani (staff)"),
    async (i, t) => respond(i, await claimTicket(i.guild, i.member, t.id))
  ),
  ticketCommand(
    new SlashCommandBuilder().setName("delete").setDescription("Hapus tiket ini secara permanen (staff)"),
    async (i, t) => {
      const result = await deleteTicket(i.guild, i.member, t.id);
      // Jika sukses channel sudah terhapus, balasan tidak bisa dikirim lagi
      if (!result.success) return respond(i, result);
    }
  ),
  ticketCommand(
    new SlashCommandBuilder()
      .setName("add")
      .setDescription("Tambahkan user ke tiket ini (staff)")
      .addUserOption((opt) => opt.setName("user").setDescription("User yang akan ditambahkan").setRequired(true)),
    async (i, t) => {
      if (!(await isTicketStaff(i.guild, i.member, ticketSupportRole(t)))) {
        return respond(i, { success: false, message: "Hanya **Staff** yang dapat menambahkan user ke tiket." });
      }
      const target = i.options.getUser("user", true);
      await (i.channel as TextChannel).permissionOverwrites.edit(target.id, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
        AttachFiles: true,
      });
      await (i.channel as TextChannel).send({ embeds: [successEmbed(`${target} ditambahkan ke tiket oleh ${i.user}.`)] });
      return respond(i, { success: true, message: `${target} berhasil ditambahkan.` });
    }
  ),
  ticketCommand(
    new SlashCommandBuilder()
      .setName("remove")
      .setDescription("Keluarkan user dari tiket ini (staff)")
      .addUserOption((opt) => opt.setName("user").setDescription("User yang akan dikeluarkan").setRequired(true)),
    async (i, t) => {
      if (!(await isTicketStaff(i.guild, i.member, ticketSupportRole(t)))) {
        return respond(i, { success: false, message: "Hanya **Staff** yang dapat mengeluarkan user dari tiket." });
      }
      const target = i.options.getUser("user", true);
      if (target.id === t.creatorId) return respond(i, { success: false, message: "Tidak dapat mengeluarkan pembuat tiket." });
      await (i.channel as TextChannel).permissionOverwrites.delete(target.id);
      await (i.channel as TextChannel).send({ embeds: [successEmbed(`${target} dikeluarkan dari tiket oleh ${i.user}.`)] });
      return respond(i, { success: true, message: `${target} berhasil dikeluarkan.` });
    }
  ),
];
