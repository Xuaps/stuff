import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const empty = () => ({ credentials: [], updates: {}, subscriptions: [], jobs: [], refreshTokens: [] });

export async function createDurableStore(file) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  let data;
  try { data = JSON.parse(await fs.readFile(file, "utf8")); } catch { data = empty(); await atomicWrite(file, data); }
  data = { ...empty(), ...data, updates: data.updates || {}, subscriptions: data.subscriptions || [], jobs: data.jobs || [], refreshTokens: data.refreshTokens || [] };
  let writing = Promise.resolve();
  const persist = () => { writing = writing.then(() => atomicWrite(file, data)); return writing; };
  return {
    data,
    save: persist,
    credential: id => data.credentials.find(item => item.id === id),
    addCredential(value) { data.credentials = data.credentials.filter(item => item.id !== value.id); data.credentials.push(value); return persist(); },
    addUpdate(room, envelope) { (data.updates[room] ||= []).push(envelope); return persist(); },
    updates(room) { return [...(data.updates[room] || [])]; },
    addSubscription(value) { data.subscriptions = data.subscriptions.filter(item => item.endpoint !== value.endpoint); data.subscriptions.push(value); return persist(); },
    addJob(value) {
      const existing = data.jobs.find(job => job.room === value.room && job.jobKey === value.jobKey);
      if (!existing) data.jobs.push({ ...value, id: value.id || crypto.randomUUID() });
      else {
        const changed = existing.sendAt !== value.sendAt || JSON.stringify(existing.payload) !== JSON.stringify(value.payload);
        Object.assign(existing, value, { id: existing.id });
        if (changed) delete existing.sentAt;
      }
      return persist();
    },
    removeJob(id, room) {
      const job = data.jobs.find(item => item.id === id);
      if (!job || job.room !== room) return Promise.resolve(false);
      data.jobs = data.jobs.filter(item => item !== job);
      return persist().then(() => true);
    },
    jobs(room) { return data.jobs.filter(job => job.room === room).map(({ id, room: ignored, payload, sentAt, ...job }) => ({ id, ...job, ...(sentAt ? { sentAt } : {}) })); },
    async dueJobs(now = Date.now()) { return data.jobs.filter(job => !job.sentAt && job.sendAt <= now); },
    async markJob(job, sentAt = Date.now()) {
      const stored = data.jobs.find(item => item.id === job.id);
      if (stored) stored.sentAt = sentAt;
      return persist();
    },
    addRefreshToken(room, tokenHash, expiresAt) { data.refreshTokens.push({ room, tokenHash, expiresAt }); return persist(); },
    rotateRefreshToken(tokenHash, next) {
      const found = data.refreshTokens.find(item => item.tokenHash === tokenHash && item.expiresAt > Date.now());
      if (!found) return Promise.resolve(false);
      found.tokenHash = next.tokenHash; found.expiresAt = next.expiresAt; return persist().then(() => found.room);
    },
  };
}

export function hashToken(value) { return crypto.createHash("sha256").update(String(value)).digest("hex"); }
async function atomicWrite(file, data) {
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(data), "utf8");
  await fs.rename(temporary, file);
}
