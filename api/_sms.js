// api/_sms.js
import twilio from "twilio";

const sid = process.env.TWILIO_ACCOUNT_SID || "";
const token = process.env.TWILIO_AUTH_TOKEN || "";
const from = process.env.TWILIO_FROM_NUMBER || "";

let client = null;
if (sid && token) client = twilio(sid, token);

export function normalizePhone(input) {
  if (!input) return "";
  const digits = input.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  // assume US
  const d = digits.replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return digits;
}

export async function sendSMS(to, body) {
  if (!client || !from) {
    console.log(`[DEV SMS] to=${to} body="${body}"`);
    return;
  }
  await client.messages.create({ to, from, body });
}
