// api/_sign.js
import crypto from "crypto";

const secret = process.env.SMS_DEEP_LINK_SECRET || "";

export function signPayload(obj, ttlSeconds = 86400) {
  const payload = { ...obj, exp: Math.floor(Date.now()/1000) + ttlSeconds };
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${sig}`;
}

export function verifyToken(token) {
  if (!token) return null;
  const [data, sig] = token.split(".");
  const expect = crypto.createHmac("sha256", secret).update(data).digest("base64url");
  if (expect !== sig) return null;
  const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
  if (payload.exp && payload.exp < Math.floor(Date.now()/1000)) return null;
  return payload;
}
