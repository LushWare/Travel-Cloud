import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, 'voice-service', '.env');
const require = createRequire(path.join(__dirname, 'voice-service', 'package.json'));

function readEnv(key) {
  const text = fs.readFileSync(ENV_PATH, 'utf8');
  const match = text.match(new RegExp(`^${key}=(.*)$`, 'm'));
  if (!match) return null;
  const value = match[1].trim().replace(/^["'](.*)["']$/, '$1');
  return value || null;
}

const normalize = (v) => String(v || '').replace(/\D/g, '') || null;

function fail(message, hint) {
  console.error(`\nERROR: ${message}`);
  if (hint) console.error(hint);
  process.exit(1);
}

if (!fs.existsSync(ENV_PATH)) {
  fail('Services/voice-service/.env not found.', 'Copy .env.example to .env and fill it in.');
}

const dbUrl = readEnv('DIRECT_URL') || readEnv('DATABASE_URL');
if (!dbUrl) fail('DIRECT_URL / DATABASE_URL missing from voice-service/.env');

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

const showOnly = process.argv.includes('--show');

try {
  if (showOnly) {
    const rows = await prisma.voiceNumber.findMany({ orderBy: { createdAt: 'asc' } });
    if (!rows.length) {
      console.log('\nNo phone number registered yet. Run without --show to register one.');
    } else {
      console.log('\nRegistered numbers:');
      for (const r of rows) {
        console.log(`  ${r.isActive ? '● ACTIVE  ' : '○ inactive'} ${r.e164}  →  agent ${r.agentId}`);
        console.log(`    label: ${r.label || '(none)'}`);
        console.log(`    disclosure: ${r.disclosureText || '(none)'}`);
      }
    }
    process.exit(0);
  }

  const rawNumber = readEnv('ELEVENLABS_PHONE_NUMBER');
  const agentId = readEnv('ELEVENLABS_AGENT_ID');

  const missing = [];
  if (!rawNumber) missing.push('ELEVENLABS_PHONE_NUMBER');
  if (!agentId) missing.push('ELEVENLABS_AGENT_ID');
  if (missing.length) {
    fail(
      `${missing.join(' and ')} missing from voice-service/.env`,
      '\nAdd these lines to Services/voice-service/.env:\n' +
      '\n  ELEVENLABS_PHONE_NUMBER=+94112345678    # the number on your website' +
      '\n  ELEVENLABS_AGENT_ID=agent_xxxxxxxxxxxx  # ElevenLabs Agents dashboard' +
      '\n  VOICE_BRAND_LABEL=Lushware Travel' +
      '\n  VOICE_DISCLOSURE_TEXT=You are speaking with an AI assistant, and this call is recorded.\n'
    );
  }

  const e164 = normalize(rawNumber);
  if (!e164 || e164.length < 7) {
    fail(`ELEVENLABS_PHONE_NUMBER "${rawNumber}" does not contain a usable phone number.`);
  }

  const label = readEnv('VOICE_BRAND_LABEL') || 'our travel team';
  const disclosureText = readEnv('VOICE_DISCLOSURE_TEXT')
    || 'You are speaking with an AI assistant, and this call is recorded.';

  const existing = await prisma.voiceNumber.findUnique({ where: { e164 } });

  const row = await prisma.voiceNumber.upsert({
    where: { e164 },
    create: { e164, label, agentId, disclosureText, isActive: true, language: 'en' },
    update: { label, agentId, disclosureText, isActive: true },
  });

  // Exactly one number answers at a time. Any previously registered number is
  // deactivated rather than deleted, so its call history stays intact.
  const { count } = await prisma.voiceNumber.updateMany({
    where: { id: { not: row.id }, isActive: true },
    data: { isActive: false },
  });

  console.log(`\n${existing ? 'Updated' : 'Registered'} the voice agent number\n`);
  console.log(`  number      ${rawNumber}   (stored as ${e164})`);
  console.log(`  agent       ${agentId}`);
  console.log(`  label       ${label}`);
  console.log(`  disclosure  ${disclosureText}`);
  if (count) console.log(`\n  Deactivated ${count} previously active number(s); their call history is kept.`);

  console.log('\nCalls to this number will now be answered by that agent.');
  console.log('Configure the ElevenLabs agent webhooks:');
  console.log('  initiation https://<your-public-host>/api/v1/webhooks/voice/inbound');
  console.log('  post-call  https://<your-public-host>/api/v1/webhooks/voice/post-call\n');
} catch (err) {
  fail(err.message);
} finally {
  await prisma.$disconnect();
}
