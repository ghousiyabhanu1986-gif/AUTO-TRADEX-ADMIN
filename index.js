const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'TRADEX_AUTO_ADMIN_2026';
const DATA_FILE = path.join(__dirname, 'keys_data.json');
const TELEGRAM_CONTACT = '@riyaz_ali_saifi';

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// ─── Data Helpers ─────────────────────────────────────────────────────────────
function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      fs.writeFileSync(DATA_FILE, JSON.stringify({ keys: [], settings: {} }, null, 2));
    }
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    console.error('Failed to load data:', e.message);
    return { keys: [], settings: {} };
  }
}

function saveData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Failed to save data:', e.message);
  }
}

// ─── Auth Middleware ───────────────────────────────────────────────────────────
function adminAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (token !== ADMIN_KEY) {
    return res.status(401).json({ success: false, message: 'Unauthorized: Invalid admin key' });
  }
  next();
}

// ─── Key Generator ────────────────────────────────────────────────────────────
function generateKey() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const segment = () => {
    let s = '';
    for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  };
  return `${segment()}-${segment()}-${segment()}`;
}

function calculateExpiry(expiryType, expiryValue) {
  if (!expiryType || expiryType === 'permanent' || expiryType === 'Permanent') return null;
  const now = new Date();
  const val = parseInt(expiryValue) || 0;
  switch (expiryType) {
    case 'minutes': case 'Minutes': return new Date(now.getTime() + val * 60 * 1000).toISOString();
    case 'hours': case 'Hours': return new Date(now.getTime() + val * 3600 * 1000).toISOString();
    case 'days': case 'Days': return new Date(now.getTime() + val * 86400 * 1000).toISOString();
    case 'weeks': case 'Weeks': return new Date(now.getTime() + val * 604800 * 1000).toISOString();
    case 'months': case '1 Month': case 'Months': return new Date(now.getTime() + val * 2592000 * 1000).toISOString();
    case 'custom': case 'Custom': return expiryValue; // Already ISO string from date picker
    default: return null;
  }
}

// ─── PUBLIC ROUTES ────────────────────────────────────────────────────────────

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'server running', telegram: TELEGRAM_CONTACT });
});

// Validate a key with UID + device binding
app.post('/api/validate', (req, res) => {
  const { key, deviceId, uid } = req.body;
  if (!key || !deviceId || !uid) {
    return res.json({ success: false, status: 'missing_params', message: 'Key, Device ID, and UID are required.' });
  }

  const data = loadData();
  const normalizedKey = key.toUpperCase().replace(/\s+/g, '');
  const record = data.keys.find(k => k.key === normalizedKey);

  if (!record) {
    return res.json({ success: false, status: 'invalid_key', message: 'Invalid key. Please check and try again.' });
  }

  if (record.deactivated) {
    return res.json({ success: false, status: 'deactivated', message: 'This key has been deactivated.' });
  }

  if (record.expiryDate && new Date(record.expiryDate) < new Date()) {
    return res.json({ success: false, status: 'expired', message: 'This key has expired.' });
  }

  // ─── UID CHECK ──────────────────────────────────────────────────────────
  // If the key has a linked_uid, it MUST match the provided uid
  if (record.linked_uid) {
    if (record.linked_uid !== uid) {
      return res.json({
        success: false,
        status: 'uid_mismatch',
        message: 'This key is not for this UID. Please get back and login with the correct ID.',
        expectedUid: record.linked_uid,
        providedUid: uid
      });
    }
  }

  // ─── DEVICE CHECK ───────────────────────────────────────────────────────
  if (record.used) {
    if (record.deviceId !== deviceId) {
      return res.json({
        success: false,
        status: 'already_used',
        message: 'KEY ALREADY USED on another device.',
        deviceId: record.deviceId
      });
    }
    // Same device — allow re-entry
    return res.json({
      success: true,
      status: 'already_activated',
      message: 'Key already activated on this device.',
      expiryDate: record.expiryDate,
      usedAt: record.usedAt
    });
  }

  // ─── FIRST-TIME ACTIVATION ──────────────────────────────────────────────
  record.used = true;
  record.deviceId = deviceId;
  record.usedAt = new Date().toISOString();
  record.linked_uid = record.linked_uid || uid; // Link UID if not already set

  // Calculate expiry from NOW based on type (timer starts at activation)
  if (record.expiryType && record.expiryType !== 'permanent' && record.expiryType !== 'Permanent') {
    record.expiryDate = calculateExpiry(record.expiryType, record.expiryValue);
  }

  saveData(data);

  return res.json({
    success: true,
    status: 'activated',
    message: 'Key activated successfully!',
    expiryDate: record.expiryDate,
    usedAt: record.usedAt
  });
});

// Check device binding (for returning users who cleared browser data)
app.post('/api/check-device', (req, res) => {
  const { deviceId } = req.body;
  if (!deviceId) {
    return res.json({ success: false, hasKey: false, message: 'Device ID required.' });
  }
  const data = loadData();
  const record = data.keys.find(k => k.deviceId === deviceId && k.used && !k.deactivated);
  if (record) {
    if (record.expiryDate && new Date(record.expiryDate) < new Date()) {
      return res.json({ success: false, hasKey: false, status: 'expired' });
    }
    return res.json({ success: true, hasKey: true, key: record.key, linked_uid: record.linked_uid });
  }
  return res.json({ success: false, hasKey: false });
});

// ─── ADMIN ROUTES ─────────────────────────────────────────────────────────────

// Generate keys
app.get('/api/admin/generate', adminAuth, (req, res) => {
  const count = parseInt(req.query.count) || 1;
  const expiryType = req.query.expiryType || 'permanent';
  const expiryValue = req.query.expiryValue || '';
  const uid = req.query.uid || '';

  if (count < 1 || count > 5000) {
    return res.json({ success: false, message: 'Count must be between 1 and 5000.' });
  }

  const data = loadData();
  const newKeys = [];

  for (let i = 0; i < count; i++) {
    let key;
    do { key = generateKey(); } while (data.keys.find(k => k.key === key));

    const record = {
      key,
      status: 'unused',
      created: new Date().toISOString(),
      expiryType: expiryType,
      expiryValue: expiryValue,
      expiryDate: null, // Timer starts only on first activation
      used: false,
      deviceId: null,
      usedAt: null,
      deactivated: false,
      linked_uid: uid || null
    };
    data.keys.push(record);
    newKeys.push(record);
  }

  saveData(data);

  return res.json({
    success: true,
    count: newKeys.length,
    keys: newKeys,
    hasExpiry: expiryType !== 'permanent' && expiryType !== 'Permanent' && !!expiryType,
    linkedUid: uid || null
  });
});

// List keys
app.get('/api/admin/keys', adminAuth, (req, res) => {
  const { status } = req.query;
  const data = loadData();
  let keys = data.keys;

  if (status === 'unused') keys = keys.filter(k => !k.used && !k.deactivated && !isExpired(k));
  else if (status === 'used') keys = keys.filter(k => k.used && !k.deactivated && !isExpired(k));
  else if (status === 'deactivated') keys = keys.filter(k => k.deactivated);
  else if (status === 'expired') keys = keys.filter(k => isExpired(k) && !k.deactivated);

  // Sort newest first
  keys.sort((a, b) => new Date(b.created) - new Date(a.created));

  return res.json({ success: true, count: keys.length, keys });
});

function isExpired(k) {
  // Only check expiry for used keys — unused keys have null expiryDate and are not expired
  if (!k.used) return false;
  return k.expiryDate && new Date(k.expiryDate) < new Date();
}

// Deactivate key
app.post('/api/admin/deactivate', adminAuth, (req, res) => {
  const { key } = req.body;
  if (!key) return res.json({ success: false, message: 'Key required.' });

  const data = loadData();
  const record = data.keys.find(k => k.key === key.toUpperCase().replace(/\s+/g, ''));
  if (!record) return res.json({ success: false, message: 'Key not found.' });

  record.deactivated = true;
  record.deactivatedAt = new Date().toISOString();
  saveData(data);

  return res.json({ success: true, message: 'Key deactivated.' });
});

// Stats
app.get('/api/admin/stats', adminAuth, (req, res) => {
  const data = loadData();
  const now = new Date();

  const totalGenerated = data.keys.length;
  const totalDeactivated = data.keys.filter(k => k.deactivated).length;
  const totalExpired = data.keys.filter(k => !k.deactivated && k.expiryDate && new Date(k.expiryDate) < now).length;
  const totalUsed = data.keys.filter(k => k.used && !k.deactivated && !(k.expiryDate && new Date(k.expiryDate) < now)).length;
  const totalUnused = data.keys.filter(k => !k.used && !k.deactivated && !(k.expiryDate && new Date(k.expiryDate) < now)).length;
  const totalActive = totalUsed + totalUnused;

  return res.json({
    success: true,
    totalGenerated,
    totalActive,
    totalUnused,
    totalUsed,
    totalDeactivated,
    totalExpired
  });
});

// Export CSV
app.get('/api/admin/export', adminAuth, (req, res) => {
  const { status } = req.query;
  const data = loadData();
  let keys = data.keys;

  if (status === 'unused') keys = keys.filter(k => !k.used && !k.deactivated);
  else if (status === 'used') keys = keys.filter(k => k.used);
  else if (status === 'deactivated') keys = keys.filter(k => k.deactivated);

  const csvHeader = 'Key,Status,Created,Expires,Used By Device,Linked UID,Used At';
  const csvRows = keys.map(k =>
    `"${k.key}","${k.deactivated ? 'Deactivated' : k.used ? 'Used' : 'Unused'}","${k.created || ''}","${k.expiryDate || 'Permanent'}","${k.deviceId || ''}","${k.linked_uid || ''}","${k.usedAt || ''}"`
  );

  const csv = [csvHeader, ...csvRows].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=tradex-auto-keys.csv');
  return res.send(csv);
});

// Set expiry for a key
app.post('/api/admin/set-expiry', adminAuth, (req, res) => {
  const { key, expiryType, expiryValue } = req.body;
  if (!key) return res.json({ success: false, message: 'Key required.' });

  const data = loadData();
  const record = data.keys.find(k => k.key === key.toUpperCase().replace(/\s+/g, ''));
  if (!record) return res.json({ success: false, message: 'Key not found.' });

  record.expiryType = expiryType;
  record.expiryValue = expiryValue;
  if (record.used && expiryType) {
    // If already used, calculate from usedAt
    const base = new Date(record.usedAt);
    record.expiryDate = calculateExpiryFromBase(expiryType, expiryValue, base);
  } else if (record.used && !expiryType) {
    record.expiryDate = null;
  } else {
    // Key is unused — store type/value but don't calculate expiry yet
    record.expiryDate = null;
  }

  saveData(data);
  return res.json({ success: true, message: 'Expiry updated.', key: record });
});

function calculateExpiryFromBase(expiryType, expiryValue, base) {
  if (!expiryType || expiryType === 'permanent' || expiryType === 'Permanent') return null;
  const val = parseInt(expiryValue) || 0;
  switch (expiryType) {
    case 'minutes': case 'Minutes': return new Date(base.getTime() + val * 60 * 1000).toISOString();
    case 'hours': case 'Hours': return new Date(base.getTime() + val * 3600 * 1000).toISOString();
    case 'days': case 'Days': return new Date(base.getTime() + val * 86400 * 1000).toISOString();
    case 'weeks': case 'Weeks': return new Date(base.getTime() + val * 604800 * 1000).toISOString();
    case 'months': case '1 Month': case 'Months': return new Date(base.getTime() + val * 2592000 * 1000).toISOString();
    case 'custom': case 'Custom': return expiryValue;
    default: return null;
  }
}

// Link UID to a key
app.post('/api/admin/link-uid', adminAuth, (req, res) => {
  const { key, uid } = req.body;
  if (!key) return res.json({ success: false, message: 'Key required.' });

  const data = loadData();
  const record = data.keys.find(k => k.key === key.toUpperCase().replace(/\s+/g, ''));
  if (!record) return res.json({ success: false, message: 'Key not found.' });

  record.linked_uid = uid || null;
  saveData(data);

  return res.json({ success: true, message: uid ? `UID linked: ${uid}` : 'UID removed.', key: record });
});

// ─── Start Server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🔑 TRADEX AUTO Server running on port ${PORT}`);
  console.log(`🔐 Admin key: ${ADMIN_KEY ? '***configured***' : 'NOT SET (using default)'}`);
  console.log(`📞 Telegram: ${TELEGRAM_CONTACT}`);
});
