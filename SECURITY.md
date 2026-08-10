# Security Policy

## Sensitive data

Never commit or attach `.env`, `.runtime/`, `data/`, browser profiles, storage-state files, screenshots, database dumps, cookies, API keys, OAuth tokens, Telegram credentials or private keys.

Create the local environment file with restrictive permissions (`install -m 600 .env.example .env`, or run `chmod 600 .env` immediately). Git ignore rules prevent accidental commits; they do not prevent other local users from reading a world-readable file.

If a credential is exposed, revoke or rotate it at the issuing service first. Removing it from the latest commit is not sufficient because Git history may retain it.

Use GitHub Actions secrets for deployment credentials. Do not place production secrets in workflow YAML, Docker images, Compose files, issue descriptions, pull requests or logs.

## Responsible operation

This project is intended for low-volume, authorized, personal deal discovery. Do not use it to bypass CAPTCHA or access controls, evade provider blocks, gain unauthorized access, spam, overload services, republish collected personal data or violate applicable law and platform terms.

Provider code must fail safely when authentication, CAPTCHA or access challenges are detected. Contributions that add bypass or evasion behavior are not accepted.

## Reporting a vulnerability

Do not disclose exploitable details or credentials in a public issue. Use GitHub's private [Report a vulnerability](https://github.com/ryan-siqueira-dev/ai-deal-finder/security/advisories/new) form. Include affected versions, reproduction steps and impact without including live secrets. If the private form is unavailable, open a public issue asking only for a private contact channel and omit all vulnerability details.

## Data handling and remote access

Set `STORE_RAW_PROVIDER_DATA=false` unless retention of provider payloads is explicitly required and authorized. Delete obsolete searches and listings with the documented CLI commands, and define a backup/retention policy for PostgreSQL and `data/` appropriate to the personal and location data you process.

Classic VNC/RFB authentication is not encrypted and effectively uses eight password characters. Keep VNC disabled except during an attended login, bind it to host loopback, require an SSH tunnel, prefer `VNC_PASSWORD_FILE`, and disable it immediately afterward.
