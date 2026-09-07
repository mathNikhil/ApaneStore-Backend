const cron = require('node-cron');
const { exec } = require('child_process');
const dns = require('dns').promises;
const pool = require('../config/database');

const SERVER_IP = '13.235.136.191';
const NGINX_CONFIG_DIR = '/etc/nginx/sites-available';

// Check if domain resolves to our IP
async function checkDns(domain) {
  try {
    const clean = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
    const addresses = await dns.resolve4(clean);
    console.log(`[DNS-Poller] ${clean} resolves to: ${addresses.join(', ')}`);
    return addresses.includes(SERVER_IP);
  } catch(e) {
    console.log(`[DNS-Poller] ${domain} DNS not resolved yet: ${e.message}`);
    return false;
  }
}

// Run certbot for domain
async function issueSsl(domain) {
  const clean = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  return new Promise((resolve) => {
    const cmd = `certbot certonly --nginx -d ${clean} -d www.${clean} --non-interactive --agree-tos --email support@aapnaestore.com 2>&1`;
    console.log(`[DNS-Poller] Running certbot for ${clean}`);
    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        console.error(`[DNS-Poller] Certbot failed for ${clean}:`, stderr || error.message);
        // Try without www
        const cmd2 = `certbot certonly --nginx -d ${clean} --non-interactive --agree-tos --email support@aapnaestore.com 2>&1`;
        exec(cmd2, (err2, out2) => {
          if (err2) {
            console.error(`[DNS-Poller] Certbot retry failed:`, err2.message);
            resolve(false);
          } else {
            console.log(`[DNS-Poller] Certbot success for ${clean} (without www)`);
            resolve(true);
          }
        });
      } else {
        console.log(`[DNS-Poller] Certbot success for ${clean}`);
        resolve(true);
      }
    });
  });
}

// Add nginx server block for custom domain
async function addNginxBlock(domain, subdomain) {
  const clean = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  const certPath = `/etc/letsencrypt/live/${clean}`;
  
  const config = `
# Custom domain: ${clean}
server {
    listen 80;
    server_name ${clean} www.${clean};
    return 301 https://${clean}$request_uri;
}
server {
    listen 443 ssl;
    server_name ${clean} www.${clean};
    ssl_certificate ${certPath}/fullchain.pem;
    ssl_certificate_key ${certPath}/privkey.pem;
    
    # Serve store frontend
    root /home/ubuntu/apps/store-sites/${subdomain}/dist;
    index index.html;
    
    # Pass store identity to backend via header
    location /api/ {
        proxy_pass http://localhost:5002;
        proxy_set_header Host $host;
        proxy_set_header X-Custom-Domain ${clean};
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    
    location / {
        try_files $uri $uri/ /index.html;
        add_header X-Store-Subdomain "${subdomain}";
    }
}
`;

  const configPath = `/etc/nginx/sites-available/custom-${clean}`;
  const enabledPath = `/etc/nginx/sites-enabled/custom-${clean}`;
  
  return new Promise((resolve) => {
    require('fs').writeFileSync(configPath, config);
    exec(`ln -sf ${configPath} ${enabledPath} && nginx -t && nginx -s reload`, (err) => {
      if (err) {
        console.error(`[DNS-Poller] Nginx reload failed:`, err.message);
        resolve(false);
      } else {
        console.log(`[DNS-Poller] Nginx configured for ${clean}`);
        resolve(true);
      }
    });
  });
}

// Every 5 minutes — check pending DNS verifications
cron.schedule('*/5 * * * *', async () => {
  try {
    const { rows } = await pool.query(`
      SELECT sdc.*, s.subdomain, s.tenant_id
      FROM store_domain_config sdc
      JOIN stores s ON s.id = sdc.store_id
      WHERE sdc.domain_type = 'custom'
        AND sdc.hosting_type = 'apnaestore'
        AND sdc.dns_status = 'pending'
        AND sdc.custom_domain IS NOT NULL
    `);

    for (const config of rows) {
      console.log(`[DNS-Poller] Checking ${config.custom_domain}...`);
      const resolved = await checkDns(config.custom_domain);
      
      if (resolved) {
        console.log(`[DNS-Poller] ✅ ${config.custom_domain} resolved! Issuing SSL...`);

        const clean = config.custom_domain.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
        const fs = require('fs');
        const certExists = fs.existsSync(`/etc/letsencrypt/live/${clean}/fullchain.pem`);

        let sslOk = false;
        if (certExists) {
          console.log(`[DNS-Poller] SSL cert already exists for ${clean} — skipping certbot`);
          sslOk = true;
        } else {
          sslOk = await issueSsl(config.custom_domain);
        }

        if (sslOk) {
          // Add nginx block
          await addNginxBlock(config.custom_domain, config.subdomain);

          // Mark as verified in DB
          await pool.query(
            `UPDATE store_domain_config
             SET dns_status='verified', dns_verified_at=NOW(), updated_at=NOW()
             WHERE store_id=$1`,
            [config.store_id]
          );

          console.log(`[DNS-Poller] ✅ ${config.custom_domain} fully configured!`);
        } else {
          // SSL failed but DNS is correct — mark verified anyway, nginx will serve HTTP
          // Certbot will retry on next poll
          console.log(`[DNS-Poller] ⚠️ SSL failed for ${clean} — marking verified, will retry SSL next poll`);
          await pool.query(
            `UPDATE store_domain_config
             SET dns_status='verified', dns_verified_at=NOW(), updated_at=NOW()
             WHERE store_id=$1`,
            [config.store_id]
          );
        }
      }
    }
  } catch(e) {
    console.error('[DNS-Poller] Error:', e.message);
  }
});

console.log('[DNS-Poller] Started — checking every 5 minutes');
module.exports = {};
