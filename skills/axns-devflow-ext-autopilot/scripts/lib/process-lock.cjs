'use strict';
// This lock protects a local helper process, never an agent's task ownership.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
function acquire(directory) {
  const file = path.join(directory, 'owner.json');
  try { fs.mkdirSync(directory); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    let old;
    try { old = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw Error('本地控制锁身份不明，保留现场：' + directory); }
    if (old.hostname !== os.hostname() || !Number.isSafeInteger(old.pid) || old.pid < 1)
      throw Error('本地控制锁身份不明，保留现场：' + directory);
    try { process.kill(old.pid, 0); throw Error('本地控制进程仍存在：' + directory); }
    catch (probe) { if (probe.code !== 'ESRCH') throw probe; }
    // Only a local OS-confirmed nonexistent helper PID permits reclaiming its helper lock.
    if (fs.readFileSync(file, 'utf8') !== JSON.stringify(old)) throw Error('本地控制锁读取期间变化');
    fs.unlinkSync(file); fs.rmdirSync(directory); fs.mkdirSync(directory);
  }
  const owner = { pid: process.pid, hostname: os.hostname(), token: randomUUID() };
  fs.writeFileSync(file, JSON.stringify(owner), { flag: 'wx' });
  return () => {
    const current = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (current.token !== owner.token) throw Error('本地控制锁身份变化，保留现场');
    fs.unlinkSync(file); fs.rmdirSync(directory);
  };
}
module.exports = { acquire };
