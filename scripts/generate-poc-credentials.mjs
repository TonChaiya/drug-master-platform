import { randomBytes, randomUUID } from "node:crypto";

const credentials = {
  POC_AGENT_KEY: `poc_${randomUUID()}`,
  POC_AGENT_SECRET: randomBytes(32).toString("base64url"),
  POC_DASHBOARD_TOKEN: randomBytes(32).toString("base64url"),
};

console.log("สร้างค่าใหม่แล้ว (แสดงครั้งเดียว; ให้นำไปใส่ .env.local ด้วยตนเอง):");
for (const [name, value] of Object.entries(credentials)) {
  console.log(`${name}=${value}`);
}
