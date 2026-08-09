# Security Policy

## Sensitive data

Never commit or attach `.env`, `.runtime/`, `data/`, browser profiles, storage-state files, screenshots, database dumps, cookies, API keys, OAuth tokens, Telegram credentials or private keys.

If a credential is exposed, revoke or rotate it at the issuing service first. Removing it from the latest commit is not sufficient because Git history may retain it.

Use GitHub Actions secrets for deployment credentials. Do not place production secrets in workflow YAML, Docker images, Compose files, issue descriptions, pull requests or logs.

## Responsible operation

This project is intended for low-volume, authorized, personal deal discovery. Do not use it to bypass CAPTCHA or access controls, evade provider blocks, gain unauthorized access, spam, overload services, republish collected personal data or violate applicable law and platform terms.

Provider code must fail safely when authentication, CAPTCHA or access challenges are detected. Contributions that add bypass or evasion behavior are not accepted.

## Reporting a vulnerability

Do not disclose exploitable details or credentials in a public issue. Contact the repository owner privately through the security-reporting channel configured on the GitHub repository. Include affected versions, reproduction steps and impact without including live secrets.
