import { Message } from "discord.js";
import { enqueueTicketMessage } from "../lib/messageQueue.js";
import { handleStickyMessage } from "../lib/sticky.js";
import { handleAutomod } from "../lib/automod.js";

/**
 * Dipanggil pada setiap messageCreate:
 * - AutoMod menghapus spam (pesan yang dihapus tidak diproses lagi)
 * - menyimpan pesan tiket (batch) untuk transkrip
 * - mendorong sticky note ke paling bawah
 */
export async function handleMessage(message: Message) {
  if (!message.guild || message.system) return;
  // Gagalnya AutoMod tidak boleh menghentikan penyimpanan transkrip / sticky
  const removed = await handleAutomod(message).catch((err) => {
    console.error("[automod] Error:", err);
    return false;
  });
  if (removed) return;

  await Promise.all([enqueueTicketMessage(message), handleStickyMessage(message)]);
}
