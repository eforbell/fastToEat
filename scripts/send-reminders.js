#!/usr/bin/env node
'use strict';

require('dotenv').config();
const { Pool } = require('pg');

const {
  sendBrrrNotification,
  buildNotificationOpenUrl,
  logNotificationDelivery,
} = require('../lib/notifications');
const { evaluateCandidates } = require('../lib/reminder-candidates');
const { runReminderPass } = require('../lib/reminder-runner');

const DRY_RUN = process.argv.includes('--dry-run');
const WINDOW_EDGE_MINUTES = Number(process.env.REMINDER_EDGE_MINUTES || 15);
const COOLDOWN_HOURS_OK = Number(process.env.REMINDER_COOLDOWN_HOURS || 20);
const COOLDOWN_HOURS_ERR = 1;
const APP_PUBLIC_URL = process.env.APP_PUBLIC_URL || null;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  await runReminderPass({
    pool,
    sendNotification: sendBrrrNotification,
    logNotificationDelivery,
    evaluateCandidates,
    buildNotificationOpenUrl,
    now: new Date(),
    dryRun: DRY_RUN,
    windowEdgeMinutes: WINDOW_EDGE_MINUTES,
    cooldownHoursOk: COOLDOWN_HOURS_OK,
    cooldownHoursErr: COOLDOWN_HOURS_ERR,
    appPublicUrl: APP_PUBLIC_URL,
    logger: console,
  });
}

if (require.main === module) {
  main()
    .catch(err => {
      console.error('Reminder run failed:', err.stack || err.message);
      process.exitCode = 1;
    })
    .finally(async () => {
      await pool.end();
    });
}
