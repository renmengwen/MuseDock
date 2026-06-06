/**
 * 从 Chrome 本地数据库提取并解密指定域名的 Cookie
 * 用法: node extract_cookies.js [域名]
 */
const { execSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const TARGET_DOMAIN = process.argv[2] || 'douyin.com';

// ========== 1. 读取 Chrome Local State 中的加密密钥 ==========
const localState = JSON.parse(
  fs.readFileSync(
    `${process.env.LOCALAPPDATA}/Google/Chrome/User Data/Local State`,
    'utf-8'
  )
);
const encryptedKeyBase64 = localState.os_crypt?.encrypted_key;
if (!encryptedKeyBase64) {
  console.error('❌ 无法读取加密密钥');
  process.exit(1);
}

// base64 解码，去掉 'DPAPI' 前缀（前5字节）
const encryptedKey = Buffer.from(encryptedKeyBase64, 'base64').subarray(5);

// ========== 2. 用 DPAPI 解密密钥（PowerShell） ==========
const psScript = `
Add-Type -AssemblyName System.Security;
$encrypted = [Convert]::FromBase64String('${encryptedKey.toString('base64')}');
$decrypted = [System.Security.Cryptography.ProtectedData]::Unprotect($encrypted, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser);
[Convert]::ToBase64String($decrypted)
`;
const masterKeyBase64 = execSync(
  `powershell -NoProfile -NonInteractive -Command "${psScript.replace(/"/g, '\\"')}"`,
  { encoding: 'utf-8', timeout: 10000 }
).trim();
const masterKey = Buffer.from(masterKeyBase64, 'base64');

console.log(`✅ 密钥解密成功 (${masterKey.length} 字节)`);

// ========== 3. 读取 Chrome Cookies 数据库 ==========
const Database = require('better-sqlite3');

// 尝试多个 Profile
const profiles = ['Default', 'Profile 1'];
const allCookies = [];

for (const profile of profiles) {
  const cookiePath = `${process.env.LOCALAPPDATA}/Google/Chrome/User Data/${profile}/Network/Cookies`;
  if (!fs.existsSync(cookiePath)) {
    console.log(`⏭  跳过 ${profile}（无 Cookie 文件）`);
    continue;
  }

  const db = new Database(cookiePath, { readonly: true });
  const rows = db.prepare(
    `SELECT host_key, name, encrypted_value, path, expires_utc, is_secure, is_httponly
     FROM cookies
     WHERE host_key LIKE ?
     ORDER BY host_key, name`
  ).all(`%${TARGET_DOMAIN}%`);

  db.close();
  console.log(`📂 ${profile}: 找到 ${rows.length} 条匹配 Cookie`);

  // ========== 4. 解密每个 Cookie ==========
  for (const row of rows) {
    try {
      const enc = row.encrypted_value;
      // Chrome v80+: v10 前缀 + 12字节 nonce + ciphertext + 16字节 auth tag
      const prefix = enc.subarray(0, 3).toString();
      let value;

      if (prefix === 'v10' || prefix === 'v11') {
        const nonce = enc.subarray(3, 15);
        const ciphertextWithTag = enc.subarray(15);
        const decipher = crypto.createDecipheriv(
          'aes-256-gcm',
          masterKey,
          nonce
        );
        value = Buffer.concat([
          decipher.update(ciphertextWithTag),
          decipher.final(),
        ]).toString('utf-8');
      } else {
        // 旧版（未加密）
        value = enc.toString('utf-8');
      }

      allCookies.push({
        domain: row.host_key,
        name: row.name,
        value: value,
        secure: !!row.is_secure,
        httpOnly: !!row.is_httponly,
      });
    } catch (e) {
      // 解密失败，跳过
    }
  }
}

// ========== 5. 输出 ==========
console.log(`\n📊 共解密 ${allCookies.length} 条 ${TARGET_DOMAIN} Cookie:\n`);
allCookies.forEach(c => {
  console.log(`  ${c.domain}\t${c.name}=${c.value.substring(0, 50)}${c.value.length > 50 ? '...' : ''}`);
});

// 输出 Cookie 字符串（可直接粘贴）
const cookieString = allCookies.map(c => `${c.name}=${c.value}`).join('; ');
console.log(`\n🔑 完整 Cookie 字符串:\n`);
console.log(cookieString);
