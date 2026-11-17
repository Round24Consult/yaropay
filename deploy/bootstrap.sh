#!/usr/bin/env bash
# Prepares a fresh Ubuntu server for the hosted edition. Safe to run again.
#
#   APP_DOMAIN=app.yaropay.com SITE_DOMAIN=yaropay.com \
#   DEPLOY_PUBKEY="ssh-ed25519 AAAA... github-actions-deploy" \
#   bash bootstrap.sh
#
# What it does: security updates (and automatic ones from now on), Docker, a firewall
# that only lets SSH, HTTP and HTTPS in, fail2ban for SSH, a little swap, a `deploy`
# user for GitHub Actions, and /opt/yaropay with a server-only .env holding freshly
# generated database and encryption secrets. Those secrets never leave the server:
# copy YAROPAY_ENCRYPTION_KEY into your password manager, because database backups
# can't decrypt saved gateway keys without it.
#
# HARDEN_SSH=1 also turns off SSH password logins (root keeps key logins). Only use it
# once logging in with a key works, and after moving any tool that signs in with the
# root password over to a key.
set -euo pipefail

: "${APP_DOMAIN:?Set APP_DOMAIN, e.g. app.yaropay.com}"
: "${SITE_DOMAIN:?Set SITE_DOMAIN, e.g. yaropay.com}"
: "${DEPLOY_PUBKEY:?Set DEPLOY_PUBKEY to the GitHub Actions deploy public key}"
APP_DIR=/opt/yaropay
DEPLOY_USER=deploy
export DEBIAN_FRONTEND=noninteractive

log() { printf '\n==> %s\n' "$*"; }
[ "$(id -u)" -eq 0 ] || { echo "Run this as root." >&2; exit 1; }

log "Packages and security updates"
apt-get update -q
apt-get -y -q -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold upgrade
apt-get install -y -q ca-certificates curl gnupg openssl ufw fail2ban python3-systemd unattended-upgrades
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF

if ! command -v docker >/dev/null 2>&1; then
  log "Docker Engine"
  # shellcheck disable=SC1091
  . /etc/os-release
  if curl -fsI "https://download.docker.com/linux/ubuntu/dists/${VERSION_CODENAME}/Release" >/dev/null; then
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
      > /etc/apt/sources.list.d/docker.list
    apt-get update -q
    apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  else
    echo "Docker has no repository for Ubuntu ${VERSION_CODENAME} yet; using Ubuntu's own packages."
    apt-get install -y -q docker.io docker-compose-v2
  fi
fi
if [ ! -f /etc/docker/daemon.json ]; then
  # Rotate container logs so they can't fill the disk.
  install -d /etc/docker
  echo '{ "log-driver": "local", "log-opts": { "max-size": "20m", "max-file": "5" } }' > /etc/docker/daemon.json
  systemctl restart docker 2>/dev/null || true
fi
systemctl enable --now docker

log "Firewall: SSH, HTTP and HTTPS only"
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw allow 443/udp >/dev/null
ufw --force enable
# The containers publish only Caddy's 80 and 443; Postgres, the API and the dashboard stay on Docker's private network.

log "fail2ban for SSH"
cat > /etc/fail2ban/jail.d/sshd.local <<'EOF'
[sshd]
enabled = true
backend = systemd
maxretry = 5
findtime = 10m
bantime = 1h
EOF
systemctl enable --now fail2ban
systemctl restart fail2ban

if ! swapon --show | grep -q .; then
  log "2 GB swap file"
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

log "Deploy user for GitHub Actions"
id "$DEPLOY_USER" >/dev/null 2>&1 || adduser --disabled-password --gecos "" "$DEPLOY_USER"
usermod -aG docker "$DEPLOY_USER"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
touch "/home/$DEPLOY_USER/.ssh/authorized_keys"
grep -qxF "$DEPLOY_PUBKEY" "/home/$DEPLOY_USER/.ssh/authorized_keys" || echo "$DEPLOY_PUBKEY" >> "/home/$DEPLOY_USER/.ssh/authorized_keys"
chown "$DEPLOY_USER:$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh/authorized_keys"
chmod 600 "/home/$DEPLOY_USER/.ssh/authorized_keys"

log "App folder and server-only secrets"
install -d -m 750 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$APP_DIR" "$APP_DIR/backups"
if [ ! -f "$APP_DIR/.env" ]; then
  umask 077
  cat > "$APP_DIR/.env" <<EOF
APP_DOMAIN=$APP_DOMAIN
SITE_DOMAIN=$SITE_DOMAIN
POSTGRES_PASSWORD=$(openssl rand -hex 24)
YAROPAY_ENCRYPTION_KEY=$(openssl rand -base64 32)
# Needed once, to create the owner account: https://$APP_DOMAIN/setup?token=<this value>
SETUP_TOKEN=$(openssl rand -hex 24)
# Email for invites and password resets, e.g. smtps://user:pass@smtp.example.com:465
SMTP_URL=
MAIL_FROM=YaroPay <no-reply@$SITE_DOMAIN>
EOF
  echo "Created $APP_DIR/.env with new secrets."
else
  echo "$APP_DIR/.env already exists; leaving its secrets alone."
fi
chown "$DEPLOY_USER:$DEPLOY_USER" "$APP_DIR/.env"
chmod 600 "$APP_DIR/.env"

if [ "${HARDEN_SSH:-0}" = 1 ]; then
  log "SSH: keys only"
  # Read before the provider's 50-cloud-init.conf, so these values win.
  cat > /etc/ssh/sshd_config.d/10-yaropay.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
EOF
  sshd -t
  systemctl reload ssh
fi

log "Done"
docker --version
docker compose version
ufw status | head -n 8
